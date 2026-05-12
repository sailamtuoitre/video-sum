#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_API_BASE_URL = 'http://localhost:3000';

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesTerm(text, term) {
  const normalizedText = normalize(text);
  const normalizedTerm = normalize(term);
  return normalizedTerm.length > 0 && normalizedText.includes(normalizedTerm);
}

function keywordScore(text, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) {
    return {
      score: 1,
      matched: [],
      missing: [],
    };
  }

  const matched = keywords.filter((keyword) => includesTerm(text, keyword));
  const missing = keywords.filter((keyword) => !includesTerm(text, keyword));

  return {
    score: matched.length / keywords.length,
    matched,
    missing,
  };
}

function forbiddenScore(text, forbiddenKeywords) {
  if (!Array.isArray(forbiddenKeywords) || forbiddenKeywords.length === 0) {
    return {
      score: 1,
      matched: [],
    };
  }

  const matched = forbiddenKeywords.filter((keyword) => includesTerm(text, keyword));

  return {
    score: matched.length === 0 ? 1 : 0,
    matched,
  };
}

function evidenceText(result) {
  const chunks = Array.isArray(result.retrievedChunks) ? result.retrievedChunks : [];
  return chunks
    .map((chunk) => {
      if (chunk && typeof chunk === 'object' && 'content' in chunk) {
        return String(chunk.content ?? '');
      }

      return String(chunk ?? '');
    })
    .join('\n\n');
}

function answerLooksGroundedWhenUnanswerable(answer) {
  const fallbackTerms = [
    'khong co',
    'khong tim thay',
    'khong du thong tin',
    'video khong',
    'noi dung video khong',
    'not enough information',
    'not found',
  ];

  return fallbackTerms.some((term) => includesTerm(answer, term));
}

function evaluateCase(testCase, result) {
  const answer = String(result.answer ?? '');
  const evidence = evidenceText(result);
  const answerKeywords = keywordScore(answer, testCase.expectedKeywords);
  const evidenceKeywords = keywordScore(evidence, testCase.expectedKeywords);
  const forbidden = forbiddenScore(answer, testCase.forbiddenKeywords);
  const retrievedChunks = Array.isArray(result.retrievedChunks)
    ? result.retrievedChunks
    : [];
  const citationScore = retrievedChunks.length > 0 ? 1 : 0;

  const expectedAnswerable = testCase.expectedAnswerable !== false;
  const answerabilityScore = expectedAnswerable
    ? 1
    : answerLooksGroundedWhenUnanswerable(answer)
      ? 1
      : 0;

  const score =
    answerKeywords.score * 0.35 +
    evidenceKeywords.score * 0.35 +
    citationScore * 0.15 +
    forbidden.score * 0.1 +
    answerabilityScore * 0.05;

  return {
    id: testCase.id ?? testCase.question,
    question: testCase.question,
    score: Number(score.toFixed(4)),
    answerKeywordScore: Number(answerKeywords.score.toFixed(4)),
    evidenceKeywordScore: Number(evidenceKeywords.score.toFixed(4)),
    citationScore,
    forbiddenScore: forbidden.score,
    answerabilityScore,
    matchedAnswerKeywords: answerKeywords.matched,
    missingAnswerKeywords: answerKeywords.missing,
    matchedEvidenceKeywords: evidenceKeywords.matched,
    missingEvidenceKeywords: evidenceKeywords.missing,
    matchedForbiddenKeywords: forbidden.matched,
    retrievedChunkCount: retrievedChunks.length,
    answer,
  };
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const text = await response.text();
  let body;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText} from ${url}: ${text}`,
    );
  }

  return body;
}

async function createSession(apiBaseUrl, videoId, title) {
  return requestJson(`${apiBaseUrl}/chat-sessions`, {
    method: 'POST',
    body: JSON.stringify({
      videoId,
      title,
    }),
  });
}

async function askQuestion(apiBaseUrl, sessionId, question) {
  return requestJson(`${apiBaseUrl}/chat-messages/ask`, {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      content: question,
    }),
  });
}

function parseArgs(argv) {
  const args = {
    apiBaseUrl: process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL,
    evalSetPath: process.env.EVAL_SET ?? 'scripts/chat-eval.sample.json',
    sessionId: process.env.SESSION_ID,
    videoId: process.env.VIDEO_ID,
    outPath: process.env.EVAL_OUT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];

    if (value === '--api-base-url' && next) {
      args.apiBaseUrl = next;
      index += 1;
    } else if (value === '--eval-set' && next) {
      args.evalSetPath = next;
      index += 1;
    } else if (value === '--session-id' && next) {
      args.sessionId = next;
      index += 1;
    } else if (value === '--video-id' && next) {
      args.videoId = next;
      index += 1;
    } else if (value === '--out' && next) {
      args.outPath = next;
      index += 1;
    }
  }

  return args;
}

function loadEvalSet(evalSetPath) {
  const resolvedPath = path.resolve(evalSetPath);
  const raw = fs.readFileSync(resolvedPath, 'utf8');
  const evalSet = JSON.parse(raw);

  if (!Array.isArray(evalSet.questions) || evalSet.questions.length === 0) {
    throw new Error('Evaluation set must include a non-empty questions array.');
  }

  return {
    ...evalSet,
    path: resolvedPath,
  };
}

function printSummary(report) {
  console.log(`Evaluation set: ${report.evalSetPath}`);
  console.log(`API: ${report.apiBaseUrl}`);
  console.log(`Session: ${report.sessionId}`);
  console.log(`Average score: ${report.averageScore}`);
  console.log('');
  console.table(
    report.results.map((result) => ({
      id: result.id,
      score: result.score,
      answer: result.answerKeywordScore,
      evidence: result.evidenceKeywordScore,
      citations: result.citationScore,
      forbidden: result.forbiddenScore,
      chunks: result.retrievedChunkCount,
    })),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evalSet = loadEvalSet(args.evalSetPath);
  const videoId = args.videoId ?? evalSet.videoId;

  if (!args.sessionId && !videoId) {
    throw new Error('Provide --session-id, --video-id, SESSION_ID, VIDEO_ID, or videoId in the eval set.');
  }

  const session = args.sessionId
    ? { id: args.sessionId }
    : await createSession(args.apiBaseUrl, videoId, `eval-${new Date().toISOString()}`);

  const results = [];

  for (const testCase of evalSet.questions) {
    const response = await askQuestion(args.apiBaseUrl, session.id, testCase.question);
    results.push(evaluateCase(testCase, response));
  }

  const averageScore =
    results.reduce((total, result) => total + result.score, 0) / results.length;

  const report = {
    generatedAt: new Date().toISOString(),
    apiBaseUrl: args.apiBaseUrl,
    evalSetPath: evalSet.path,
    sessionId: session.id,
    videoId,
    averageScore: Number(averageScore.toFixed(4)),
    results,
  };

  printSummary(report);

  if (args.outPath) {
    fs.writeFileSync(path.resolve(args.outPath), `${JSON.stringify(report, null, 2)}\n`);
    console.log('');
    console.log(`Saved report: ${path.resolve(args.outPath)}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
