import { Injectable, NotFoundException } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessageChunk } from '@langchain/core/messages';
import { Prisma } from '@prisma/client';
import { ChunkService } from '../chunks/chunk.service';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryConfigService } from './summary-config.service';
import { SummaryPromptBuilder } from './summary-prompt.builder';
import { SummaryTextService } from './summary-text.service';
import {
  CollapsedSummary,
  MapSummary,
  SourceChunk,
  SummaryConfig,
  SummaryDraft,
  SummaryJson,
} from './summary.types';

@Injectable()
export class SummaryService {
  private readonly sentenceLimit = 180;
  private readonly sectionSize = 4;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
    private readonly configService: SummaryConfigService,
    private readonly promptBuilder: SummaryPromptBuilder,
    private readonly text: SummaryTextService,
  ) {}

  findAll(videoId?: string) {
    return this.prisma.summary.findMany({
      where: videoId ? { videoId } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const summary = await this.prisma.summary.findUnique({
      where: {
        id,
      },
    });

    if (!summary) {
      throw new NotFoundException(`Summary with id "${id}" not found`);
    }

    return summary;
  }

  async createFromVideo(videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: {
        id: videoId,
      },
      select: {
        id: true,
      },
    });

    if (!video) {
      throw new NotFoundException(`Video with id "${videoId}" not found`);
    }

    const transcript = await this.prisma.transcript.findFirst({
      where: {
        videoId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!transcript) {
      throw new NotFoundException(
        `Transcript for video with id "${videoId}" not found`,
      );
    }

    const sourceChunks = await this.loadSourceChunks({
      videoId,
      transcriptId: transcript.id,
      rawText: transcript.rawText,
    });
    const fallbackDraft = this.buildSummaryDraft(sourceChunks);
    const draft = await this.buildAiSummaryDraft(sourceChunks, fallbackDraft);
    const completionTokens = this.text.countWords(
      [draft.simplifiedText, ...draft.keyPoints, ...draft.mainTopics].join(' '),
    );

    return this.prisma.summary.upsert({
      where: {
        videoId,
      },
      create: {
        videoId,
        keyPoints: draft.keyPoints,
        simplifiedText: draft.simplifiedText,
        mainTopics: draft.mainTopics,
        modelUsed: draft.modelUsed,
        promptTokens: draft.sourceWordCount,
        completionTokens,
      },
      update: {
        keyPoints: draft.keyPoints,
        simplifiedText: draft.simplifiedText,
        mainTopics: draft.mainTopics,
        modelUsed: draft.modelUsed,
        promptTokens: draft.sourceWordCount,
        completionTokens,
      },
    });
  }

  async remove(id: string) {
    try {
      return await this.prisma.summary.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Summary with id "${id}" not found`);
      }

      throw error;
    }
  }

  private async loadSourceChunks(input: {
    videoId: string;
    transcriptId: string;
    rawText: string;
  }): Promise<SourceChunk[]> {
    const chunks = await this.chunkService.ensureTranscriptChunks(
      input.videoId,
      input.transcriptId,
      input.rawText,
    );

    return chunks.map((chunk) => ({
      id: chunk.id,
      videoId: chunk.videoId,
      transcriptId: chunk.transcriptId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    }));
  }

  private buildSummaryDraft(chunks: SourceChunk[]): SummaryDraft {
    const cleanChunks = this.cleanChunks(chunks);

    if (cleanChunks.length === 0) {
      throw new NotFoundException('No transcript content found for summary');
    }

    const digests = cleanChunks.map((chunk) => ({
      chunk,
      digest: this.buildChunkDigest(chunk.content),
    }));
    const sectionSummaries = this.buildSectionSummaries(
      digests.map((item) => item.digest),
    );
    const keyPoints = this.extractKeyPoints([
      ...sectionSummaries,
      ...digests.map((item) => item.digest),
    ]);
    const simplifiedText = this.buildSimplifiedText(
      sectionSummaries,
      keyPoints,
    );
    const sourceText = cleanChunks.map((chunk) => chunk.content).join(' ');

    return {
      keyPoints,
      simplifiedText,
      mainTopics: this.extractMainTopics(sourceText),
      modelUsed: 'hierarchical-extractive-v2',
      sourceChunkCount: cleanChunks.length,
      sourceWordCount: this.text.countWords(sourceText),
    };
  }

  private async buildAiSummaryDraft(
    chunks: SourceChunk[],
    fallbackDraft: SummaryDraft,
  ): Promise<SummaryDraft> {
    const groqApiKey = process.env.GROQ_API_KEY;
    const config = this.configService.getConfig();

    if (!groqApiKey || config.mode === 'fallback') {
      return fallbackDraft;
    }

    try {
      const selectedChunks = this.selectSummaryChunks(chunks, config);
      const shouldUseDirect =
        config.mode === 'direct' ||
        (config.mode === 'auto' &&
          selectedChunks.length <= config.directMaxChunks);

      if (shouldUseDirect) {
        return await this.buildDirectAiSummaryDraft(
          selectedChunks,
          fallbackDraft,
          config,
          groqApiKey,
        );
      }

      return await this.buildMapReduceSummaryDraft(
        selectedChunks,
        fallbackDraft,
        config,
        groqApiKey,
      );
    } catch (error) {
      console.error(
        'AI summary failed. Falling back to extractive summary:',
        error,
      );
      return fallbackDraft;
    }
  }

  private async buildDirectAiSummaryDraft(
    chunks: SourceChunk[],
    fallbackDraft: SummaryDraft,
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<SummaryDraft> {
    const llm = this.createLlm(config, groqApiKey, config.reduceMaxTokens);
    const response = await this.invokeLlmWithRetry(
      () =>
        this.invokeJsonLlm(
          llm,
          this.promptBuilder.buildDirectSummaryPrompt(
            chunks,
            config.chunkWordLimit,
          ),
        ),
      config,
    );
    const parsed = this.parseSummaryJson(
      this.extractMessageText(response.content),
    );

    return {
      ...fallbackDraft,
      ...parsed,
      modelUsed: `groq:${config.model}:math-summary-direct-v2`,
    };
  }

  private async buildMapReduceSummaryDraft(
    chunks: SourceChunk[],
    fallbackDraft: SummaryDraft,
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<SummaryDraft> {
    const mapSummaries = await this.buildMapSummaries(
      chunks,
      config,
      groqApiKey,
    );
    const collapsedSummaries = await this.collapseMapSummariesIfNeeded(
      mapSummaries,
      config,
      groqApiKey,
    );
    const reduced = await this.reduceSummaries(
      collapsedSummaries,
      config,
      groqApiKey,
    );

    return {
      ...fallbackDraft,
      ...reduced,
      modelUsed: `groq:${config.model}:math-summary-mapreduce-v1`,
    };
  }

  private async buildMapSummaries(
    chunks: SourceChunk[],
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<MapSummary[]> {
    const groups = this.groupChunks(chunks, config.mapGroupSize);
    const llm = this.createLlm(config, groqApiKey, config.mapMaxTokens);
    const summaries: MapSummary[] = [];

    for (const [index, group] of groups.entries()) {
      try {
        const response = await this.invokeLlmWithRetry(
          () =>
            this.invokeJsonLlm(
              llm,
              this.promptBuilder.buildMapSummaryPrompt(
                index,
                group,
                config.chunkWordLimit,
              ),
            ),
          config,
        );
        summaries.push(
          this.parseMapSummary(this.extractMessageText(response.content), {
            groupIndex: index,
            chunks: group,
          }),
        );
      } catch (error) {
        console.error(`Map summary failed for group ${index}:`, error);
        summaries.push(this.buildFallbackMapSummary(index, group));
      }
    }

    return summaries;
  }

  private async collapseMapSummariesIfNeeded(
    mapSummaries: MapSummary[],
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<Array<MapSummary | CollapsedSummary>> {
    if (mapSummaries.length <= config.collapseMaxGroups) {
      return mapSummaries;
    }

    const groups = this.groupItems(mapSummaries, config.collapseMaxGroups);
    const llm = this.createLlm(config, groqApiKey, config.collapseMaxTokens);
    const collapsed: CollapsedSummary[] = [];

    for (const [index, group] of groups.entries()) {
      try {
        const response = await this.invokeLlmWithRetry(
          () =>
            this.invokeJsonLlm(
              llm,
              this.promptBuilder.buildCollapseSummaryPrompt(index, group),
            ),
          config,
        );
        collapsed.push(
          this.parseCollapsedSummary(
            this.extractMessageText(response.content),
            group,
          ),
        );
      } catch (error) {
        console.error(`Collapse summary failed for batch ${index}:`, error);
        collapsed.push(this.buildFallbackCollapsedSummary(group));
      }
    }

    return collapsed;
  }

  private async reduceSummaries(
    summaries: Array<MapSummary | CollapsedSummary>,
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<SummaryJson> {
    const llm = this.createLlm(config, groqApiKey, config.reduceMaxTokens);
    const response = await this.invokeLlmWithRetry(
      () =>
        this.invokeJsonLlm(
          llm,
          this.promptBuilder.buildReduceSummaryPrompt(summaries),
        ),
      config,
    );

    return this.parseSummaryJson(this.extractMessageText(response.content));
  }

  private createLlm(
    config: SummaryConfig,
    groqApiKey: string,
    maxTokens: number,
  ) {
    return new ChatOpenAI({
      model: config.model,
      apiKey: groqApiKey,
      configuration: {
        baseURL: config.baseUrl,
      },
      temperature: 0.1,
      maxTokens,
    });
  }

  private invokeJsonLlm(
    llm: ReturnType<typeof this.createLlm>,
    prompt: string,
  ): Promise<AIMessageChunk> {
    return llm.invoke(prompt, {
      response_format: {
        type: 'json_object',
      },
    });
  }

  private async invokeLlmWithRetry<T>(
    invoke: () => Promise<T>,
    config: SummaryConfig,
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= config.retryAttempts; attempt += 1) {
      try {
        return await invoke();
      } catch (error) {
        lastError = error;

        if (
          attempt >= config.retryAttempts ||
          !this.isRetryableLlmError(error)
        ) {
          throw error;
        }

        const delayMs = this.getRetryDelayMs(error, attempt, config);
        console.warn(
          `Summary AI rate limited. Retrying in ${delayMs}ms ` +
            `(attempt ${attempt + 1}/${config.retryAttempts}).`,
        );
        await this.sleep(delayMs);
      }
    }

    throw lastError;
  }

  private isRetryableLlmError(error: unknown): boolean {
    const record = this.toErrorRecord(error);
    const status = record?.status;
    const code = record?.code;
    const lcErrorCode = record?.lc_error_code;

    return (
      status === 429 ||
      code === 'rate_limit_exceeded' ||
      lcErrorCode === 'MODEL_RATE_LIMIT'
    );
  }

  private getRetryDelayMs(
    error: unknown,
    attempt: number,
    config: SummaryConfig,
  ): number {
    const retryAfterMs = this.getRetryAfterMs(error);

    if (retryAfterMs !== null) {
      return retryAfterMs;
    }

    return config.retryBaseDelayMs * 2 ** attempt;
  }

  private getRetryAfterMs(error: unknown): number | null {
    const headers = this.toErrorRecord(error)?.headers;

    if (!headers || typeof headers !== 'object' || !('get' in headers)) {
      return null;
    }

    const getHeader = headers.get;

    if (typeof getHeader !== 'function') {
      return null;
    }

    const retryAfter = getHeader.call(headers, 'retry-after') as unknown;

    if (typeof retryAfter !== 'string') {
      return null;
    }

    const seconds = Number.parseFloat(retryAfter);

    if (!Number.isFinite(seconds) || seconds < 0) {
      return null;
    }

    return Math.ceil(seconds * 1000);
  }

  private toErrorRecord(error: unknown): Record<string, unknown> | null {
    if (typeof error !== 'object' || error === null) {
      return null;
    }

    return error as Record<string, unknown>;
  }

  private sleep(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  private selectSummaryChunks(
    chunks: SourceChunk[],
    config: SummaryConfig,
  ): SourceChunk[] {
    const cleanChunks = this.cleanChunks(chunks);
    const maxChunks = config.mapGroupSize * config.maxMapGroups;

    if (cleanChunks.length <= maxChunks) {
      return cleanChunks;
    }

    return cleanChunks
      .map((chunk) => ({
        chunk,
        score: this.scoreChunk(chunk, cleanChunks.length),
      }))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.chunk.chunkIndex - right.chunk.chunkIndex,
      )
      .slice(0, maxChunks)
      .map((item) => item.chunk)
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
  }

  private scoreChunk(chunk: SourceChunk, totalChunks: number): number {
    const normalized = this.text.normalizeForCompare(chunk.content);
    let score = 0;

    if (chunk.chunkIndex <= 1) {
      score += 4;
    }

    if (chunk.chunkIndex >= totalChunks - 2) {
      score += 3;
    }

    if (/[=+\-*/^<>]|\d/.test(chunk.content)) {
      score += 4;
    }

    const mathKeywords = [
      'bai toan',
      'cong thuc',
      'dieu kien',
      'giai',
      'ket luan',
      'phuong trinh',
      'vi du',
      'dao ham',
      'tich phan',
      'hinh hoc',
      'xac suat',
      'he phuong trinh',
    ];

    for (const keyword of mathKeywords) {
      if (normalized.includes(keyword)) {
        score += 2;
      }
    }

    const wordCount = this.text.countWords(chunk.content);

    if (wordCount >= 40 && wordCount <= 220) {
      score += 2;
    }

    return score;
  }

  private cleanChunks(chunks: SourceChunk[]): SourceChunk[] {
    return chunks
      .map((chunk) => ({
        ...chunk,
        content: this.text.normalizeWhitespace(chunk.content),
      }))
      .filter((chunk) => chunk.content.length > 0);
  }

  private groupChunks(chunks: SourceChunk[], groupSize: number) {
    return this.groupItems(chunks, groupSize);
  }

  private groupItems<T>(items: T[], groupSize: number): T[][] {
    const groups: T[][] = [];

    for (let index = 0; index < items.length; index += groupSize) {
      groups.push(items.slice(index, index + groupSize));
    }

    return groups;
  }

  private parseSummaryJson(content: string): SummaryJson {
    const parsed = this.parseJsonObject(content);

    if (!this.isSummaryJson(parsed)) {
      throw new Error('AI summary response does not match expected schema.');
    }

    return {
      keyPoints: this.cleanStringArray(parsed.keyPoints, 6),
      simplifiedText: this.text.normalizeWhitespace(parsed.simplifiedText),
      mainTopics: this.cleanStringArray(parsed.mainTopics, 10),
    };
  }

  private parseMapSummary(
    content: string,
    fallback: {
      groupIndex: number;
      chunks: SourceChunk[];
    },
  ): MapSummary {
    const parsed = this.parseJsonObject(content);

    if (!this.isMapSummaryJson(parsed)) {
      throw new Error('Map summary response does not match expected schema.');
    }

    return {
      groupIndex: this.cleanNumber(parsed.groupIndex, fallback.groupIndex),
      sourceChunkIndexes: this.cleanNumberArray(
        parsed.sourceChunkIndexes,
        fallback.chunks.map((chunk) => chunk.chunkIndex),
      ),
      keyIdeas: this.cleanStringArray(parsed.keyIdeas, 8),
      importantFormulas: this.cleanStringArray(parsed.importantFormulas, 8),
      solutionSteps: this.cleanStringArray(parsed.solutionSteps, 10),
      missingInformation: this.cleanStringArray(parsed.missingInformation, 6),
    };
  }

  private parseCollapsedSummary(
    content: string,
    fallbackGroup: MapSummary[],
  ): CollapsedSummary {
    const parsed = this.parseJsonObject(content);

    if (!this.isCollapsedSummaryJson(parsed)) {
      throw new Error(
        'Collapsed summary response does not match expected schema.',
      );
    }

    return {
      groupIndexes: this.cleanNumberArray(
        parsed.groupIndexes,
        fallbackGroup.map((summary) => summary.groupIndex),
      ),
      sourceChunkIndexes: this.cleanNumberArray(
        parsed.sourceChunkIndexes,
        this.uniqueNumbers(
          fallbackGroup.flatMap((summary) => summary.sourceChunkIndexes),
        ),
      ),
      keyIdeas: this.cleanStringArray(parsed.keyIdeas, 10),
      importantFormulas: this.cleanStringArray(parsed.importantFormulas, 10),
      solutionSteps: this.cleanStringArray(parsed.solutionSteps, 12),
      missingInformation: this.cleanStringArray(parsed.missingInformation, 8),
    };
  }

  private parseJsonObject(text: string): unknown {
    const candidates = this.extractJsonCandidates(text);

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        const repaired = this.repairJsonCandidate(candidate);

        if (repaired !== candidate) {
          try {
            return JSON.parse(repaired) as unknown;
          } catch {
            continue;
          }
        }
      }
    }

    throw new Error('AI response did not contain a valid JSON object.');
  }

  private extractJsonCandidates(text: string): string[] {
    const candidates: string[] = [];
    const fencedJson = /```(?:json)?\s*([\s\S]*?)```/gi;
    let match: RegExpExecArray | null;

    while ((match = fencedJson.exec(text)) !== null) {
      if (match[1]) {
        candidates.push(match[1].trim());
      }
    }

    const balanced = this.extractBalancedJsonObjects(text);
    candidates.push(...balanced);

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      candidates.push(text.slice(firstBrace, lastBrace + 1).trim());
    }

    return [...new Set(candidates.filter((candidate) => candidate.length > 0))];
  }

  private repairJsonCandidate(candidate: string): string {
    return this.escapeControlCharactersInStrings(
      this.normalizeJsonQuotes(candidate)
        .replace(/^\uFEFF/, '')
        .replace(/,\s*([}\]])/g, '$1')
        .trim(),
    );
  }

  private normalizeJsonQuotes(candidate: string): string {
    return candidate
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
  }

  private escapeControlCharactersInStrings(candidate: string): string {
    let output = '';
    let inString = false;
    let escaped = false;

    for (let index = 0; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (inString) {
        if (escaped) {
          output += char;
          escaped = false;
          continue;
        }

        if (char === '\\') {
          output += char;
          escaped = true;
          continue;
        }

        if (char === '"') {
          output += char;
          inString = false;
          continue;
        }

        if (char === '\n') {
          output += '\\n';
          continue;
        }

        if (char === '\r') {
          output += '\\r';
          continue;
        }

        if (char === '\t') {
          output += '\\t';
          continue;
        }
      } else if (char === '"') {
        inString = true;
      }

      output += char;
    }

    return output;
  }

  private extractBalancedJsonObjects(text: string): string[] {
    const candidates: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }

        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === '{') {
        if (depth === 0) {
          start = index;
        }

        depth += 1;
      } else if (char === '}' && depth > 0) {
        depth -= 1;

        if (depth === 0 && start !== -1) {
          candidates.push(text.slice(start, index + 1));
          start = -1;
        }
      }
    }

    return candidates;
  }

  private extractMessageText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (this.isTextContentPart(item)) {
            return item.text;
          }

          return '';
        })
        .join('\n');
    }

    return String(content);
  }

  private isTextContentPart(value: unknown): value is { text: string } {
    if (typeof value !== 'object' || value === null || !('text' in value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    return typeof candidate.text === 'string';
  }

  private isSummaryJson(value: unknown): value is {
    keyPoints: unknown[];
    simplifiedText: string;
    mainTopics: unknown[];
  } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'keyPoints' in value &&
      Array.isArray(value.keyPoints) &&
      'simplifiedText' in value &&
      typeof value.simplifiedText === 'string' &&
      'mainTopics' in value &&
      Array.isArray(value.mainTopics)
    );
  }

  private isMapSummaryJson(value: unknown): value is {
    groupIndex: unknown;
    sourceChunkIndexes: unknown[];
    keyIdeas: unknown[];
    importantFormulas: unknown[];
    solutionSteps: unknown[];
    missingInformation: unknown[];
  } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'groupIndex' in value &&
      'sourceChunkIndexes' in value &&
      Array.isArray(value.sourceChunkIndexes) &&
      'keyIdeas' in value &&
      Array.isArray(value.keyIdeas) &&
      'importantFormulas' in value &&
      Array.isArray(value.importantFormulas) &&
      'solutionSteps' in value &&
      Array.isArray(value.solutionSteps) &&
      'missingInformation' in value &&
      Array.isArray(value.missingInformation)
    );
  }

  private isCollapsedSummaryJson(value: unknown): value is {
    groupIndexes: unknown[];
    sourceChunkIndexes: unknown[];
    keyIdeas: unknown[];
    importantFormulas: unknown[];
    solutionSteps: unknown[];
    missingInformation: unknown[];
  } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'groupIndexes' in value &&
      Array.isArray(value.groupIndexes) &&
      'sourceChunkIndexes' in value &&
      Array.isArray(value.sourceChunkIndexes) &&
      'keyIdeas' in value &&
      Array.isArray(value.keyIdeas) &&
      'importantFormulas' in value &&
      Array.isArray(value.importantFormulas) &&
      'solutionSteps' in value &&
      Array.isArray(value.solutionSteps) &&
      'missingInformation' in value &&
      Array.isArray(value.missingInformation)
    );
  }

  private cleanStringArray(values: unknown[], limit: number): string[] {
    return values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => this.text.normalizeWhitespace(value))
      .filter((value) => value.length > 0)
      .slice(0, limit);
  }

  private cleanNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private cleanNumberArray(values: unknown[], fallback: number[]): number[] {
    const clean = values.filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );

    return clean.length > 0 ? this.uniqueNumbers(clean) : fallback;
  }

  private uniqueNumbers(values: number[]): number[] {
    return [...new Set(values)].sort((left, right) => left - right);
  }

  private buildFallbackMapSummary(
    groupIndex: number,
    chunks: SourceChunk[],
  ): MapSummary {
    return {
      groupIndex,
      sourceChunkIndexes: chunks.map((chunk) => chunk.chunkIndex),
      keyIdeas: chunks.map((chunk) => this.buildChunkDigest(chunk.content)),
      importantFormulas: [],
      solutionSteps: [],
      missingInformation: [],
    };
  }

  private buildFallbackCollapsedSummary(
    summaries: MapSummary[],
  ): CollapsedSummary {
    return {
      groupIndexes: summaries.map((summary) => summary.groupIndex),
      sourceChunkIndexes: this.uniqueNumbers(
        summaries.flatMap((summary) => summary.sourceChunkIndexes),
      ),
      keyIdeas: summaries.flatMap((summary) => summary.keyIdeas).slice(0, 10),
      importantFormulas: summaries
        .flatMap((summary) => summary.importantFormulas)
        .slice(0, 10),
      solutionSteps: summaries
        .flatMap((summary) => summary.solutionSteps)
        .slice(0, 12),
      missingInformation: summaries
        .flatMap((summary) => summary.missingInformation)
        .slice(0, 8),
    };
  }

  private buildChunkDigest(text: string): string {
    const sentences = this.text.splitSentences(text);
    const selected = sentences
      .filter((sentence) => this.text.countWords(sentence) >= 5)
      .slice(0, 2);
    const digest = selected.length > 0 ? selected.join(' ') : text;

    return this.text.truncateWords(digest, 48);
  }

  private buildSectionSummaries(digests: string[]): string[] {
    const summaries: string[] = [];

    for (let index = 0; index < digests.length; index += this.sectionSize) {
      const section = digests.slice(index, index + this.sectionSize);
      summaries.push(
        this.text.truncateWords(section.join(' '), this.sentenceLimit),
      );
    }

    return summaries;
  }

  private extractKeyPoints(candidates: string[]): string[] {
    const unique = new Map<string, string>();

    for (const candidate of candidates) {
      const sentences = this.text.splitSentences(candidate);

      for (const sentence of sentences) {
        const clean = this.text.truncateWords(sentence, 36);
        const key = this.text.normalizeForCompare(clean);

        if (key.length >= 20 && !unique.has(key)) {
          unique.set(key, clean);
        }

        if (unique.size >= 6) {
          return [...unique.values()];
        }
      }
    }

    return [...unique.values()];
  }

  private buildSimplifiedText(
    sectionSummaries: string[],
    keyPoints: string[],
  ): string {
    const source = sectionSummaries.length > 0 ? sectionSummaries : keyPoints;
    const text = source.slice(0, 3).join(' ');

    return this.text.truncateWords(text, 220);
  }

  private extractMainTopics(text: string): string[] {
    const mathPhrases = this.extractMathPhrases(text);
    const words = this.text
      .normalizeForCompare(text)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !this.stopWords.has(word));

    const frequencies = new Map<string, number>();

    for (const word of words) {
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }

    const frequentWords = [...frequencies.entries()]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .map(([word]) => word)
      .slice(0, 8);

    return [...new Set([...mathPhrases, ...frequentWords])].slice(0, 10);
  }

  private extractMathPhrases(text: string): string[] {
    const normalized = this.text.normalizeForCompare(text);
    const topics = [
      ['linear equation', /\b(linear equation|phuong trinh bac nhat)\b/],
      ['quadratic equation', /\b(quadratic equation|phuong trinh bac hai)\b/],
      ['system of equations', /\b(system of equations|he phuong trinh)\b/],
      ['function', /\b(function|ham so)\b/],
      ['derivative', /\b(derivative|dao ham)\b/],
      ['integral', /\b(integral|tich phan)\b/],
      ['geometry', /\b(geometry|hinh hoc)\b/],
      ['probability', /\b(probability|xac suat)\b/],
      ['statistics', /\b(statistics|thong ke)\b/],
      ['vector', /\b(vector|vec to)\b/],
    ] as const;

    return topics
      .filter(([, pattern]) => pattern.test(normalized))
      .map(([topic]) => topic);
  }

  private readonly stopWords = new Set([
    'about',
    'after',
    'also',
    'and',
    'are',
    'because',
    'but',
    'can',
    'cho',
    'cac',
    'cach',
    'cua',
    'duoc',
    'for',
    'from',
    'hay',
    'khi',
    'la',
    'lam',
    'mot',
    'nay',
    'neu',
    'nhu',
    'not',
    'qua',
    'that',
    'the',
    'thi',
    'this',
    'trong',
    'voi',
    'you',
  ]);
}
