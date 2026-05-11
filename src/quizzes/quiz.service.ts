import { Injectable, NotFoundException } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../summaries/summary.service';

type QuizOption = 'A' | 'B' | 'C' | 'D';

type SummaryInput = {
  keyPoints: unknown;
  simplifiedText: string;
  mainTopics: unknown;
  modelUsed: string | null;
};

type SourceChunk = Awaited<
  ReturnType<PrismaService['chunk']['findMany']>
>[number];

type MiniTestQuestion = {
  questionText: string;
  options: Record<QuizOption, string>;
  correctOption: QuizOption;
  explanation: string;
  questionIndex: number;
  sourceChunkId: string | null;
};

type GeneratedQuiz = {
  questions: MiniTestQuestion[];
  modelUsed: string;
};

type AiQuizQuestion = {
  questionText: string;
  options: Record<QuizOption, string>;
  correctOption: QuizOption;
  explanation: string;
};

type QuestionSource = {
  kind: 'chunk' | 'keyPoint' | 'topic' | 'sentence';
  text: string;
  sourceChunkId: string | null;
};

@Injectable()
export class QuizService {
  private readonly totalQuestions = 10;
  private readonly aiQuizMaxChars = 12000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly summaryService: SummaryService,
  ) {}

  async createFromVideo(videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: {
        id: videoId,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!video) {
      throw new NotFoundException(`Video with id "${videoId}" not found`);
    }

    const summary = await this.ensureSummary(videoId);
    const sourceChunks = await this.findSourceChunks(videoId);
    const generated = await this.buildMiniTestQuestions(summary, sourceChunks);

    return this.prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          videoId,
          title: video.title ? `Mini test: ${video.title}` : 'Mini test',
          totalQuestions: generated.questions.length,
          modelUsed: generated.modelUsed,
        },
      });

      await tx.quizQuestion.createMany({
        data: generated.questions.map((question) => ({
          quizId: quiz.id,
          questionText: question.questionText,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
          questionIndex: question.questionIndex,
          sourceChunkId: question.sourceChunkId,
        })),
      });

      return tx.quiz.findUnique({
        where: {
          id: quiz.id,
        },
        include: {
          questions: {
            orderBy: {
              questionIndex: 'asc',
            },
          },
        },
      });
    });
  }

  findAll(videoId?: string) {
    return this.prisma.quiz.findMany({
      where: videoId ? { videoId } : undefined,
      include: {
        questions: {
          orderBy: {
            questionIndex: 'asc',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const quiz = await this.prisma.quiz.findUnique({
      where: {
        id,
      },
      include: {
        questions: {
          orderBy: {
            questionIndex: 'asc',
          },
        },
      },
    });

    if (!quiz) {
      throw new NotFoundException(`Quiz with id "${id}" not found`);
    }

    return quiz;
  }

  async remove(id: string) {
    try {
      return await this.prisma.quiz.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Quiz with id "${id}" not found`);
      }

      throw error;
    }
  }

  private async ensureSummary(videoId: string): Promise<SummaryInput> {
    const existing = await this.prisma.summary.findUnique({
      where: {
        videoId,
      },
    });

    if (existing) {
      return existing;
    }

    return this.summaryService.createFromVideo(videoId);
  }

  private async findSourceChunks(videoId: string) {
    const transcript = await this.prisma.transcript.findFirst({
      where: {
        videoId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!transcript) {
      return [];
    }

    return this.prisma.chunk.findMany({
      where: {
        transcriptId: transcript.id,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });
  }

  private async buildMiniTestQuestions(
    summary: SummaryInput,
    sourceChunks: SourceChunk[],
  ): Promise<GeneratedQuiz> {
    const aiQuestions = await this.buildAiMiniTestQuestions(
      summary,
      sourceChunks,
    );

    if (aiQuestions.length === this.totalQuestions) {
      return {
        questions: aiQuestions,
        modelUsed: `groq:${process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant'}:math-quiz-v1`,
      };
    }

    return {
      questions: this.buildRuleMiniTestQuestions(summary, sourceChunks),
      modelUsed: 'summary-rule-minitest-v2',
    };
  }

  private async buildAiMiniTestQuestions(
    summary: SummaryInput,
    sourceChunks: SourceChunk[],
  ): Promise<MiniTestQuestion[]> {
    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      return [];
    }

    try {
      const model = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
      const llm = new ChatOpenAI({
        model,
        apiKey: groqApiKey,
        configuration: {
          baseURL:
            process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        },
        temperature: 0.2,
        maxTokens: 2200,
      });

      const response = await llm.invoke(
        this.buildMathQuizPrompt(summary, sourceChunks),
      );
      const parsed = this.parseAiQuizQuestions(
        this.extractMessageText(response.content),
      );

      return parsed.map((question, index) => ({
        ...question,
        questionIndex: index,
        sourceChunkId: this.findMatchingChunkId(
          `${question.questionText} ${question.explanation}`,
          sourceChunks,
        ),
      }));
    } catch (error) {
      console.error(
        'AI quiz generation failed. Falling back to rule-based quiz:',
        error,
      );
      return [];
    }
  }

  private buildMathQuizPrompt(
    summary: SummaryInput,
    sourceChunks: SourceChunk[],
  ): string {
    const keyPoints = this.normalizeStringArray(summary.keyPoints);
    const mainTopics = this.normalizeStringArray(summary.mainTopics);
    const evidence = this.buildChunkEvidence(sourceChunks);

    return `Bạn là hệ thống tạo câu hỏi trắc nghiệm cho video học toán.

Nhiệm vụ:
- Tạo đúng ${this.totalQuestions} câu hỏi trắc nghiệm tiếng Việt.
- Mỗi câu có 4 lựa chọn A, B, C, D và chỉ 1 đáp án đúng.
- Câu hỏi phải dựa trực tiếp trên SUMMARY và SOURCE_CHUNKS.
- Ưu tiên câu hỏi kiểm tra hiểu bản chất, công thức, điều kiện áp dụng, bước biến đổi và lỗi sai thường gặp.
- Nếu dữ kiện trong transcript không đủ, hãy hỏi về phần có đủ bằng chứng thay vì suy đoán.

Quy tắc bắt buộc:
1. Không tạo câu hỏi ngoài nội dung transcript/summary.
2. Không tạo đáp án nhiễu vô nghĩa như "lựa chọn phụ" hoặc "không được nêu" nếu không cần thiết.
3. Đáp án nhiễu phải hợp lý nhưng sai rõ ràng dựa trên nội dung học.
4. Giải thích phải nêu vì sao đáp án đúng, ngắn gọn, dựa trên nguồn.
5. Không dùng câu hỏi mơ hồ kiểu "nội dung nào được hỗ trợ rõ nhất".
6. Nếu có công thức hoặc điều kiện xác định, phải giữ chính xác.

Chỉ trả về JSON hợp lệ, không bọc markdown:
{
  "questions": [
    {
      "questionText": "Câu hỏi tự nhiên, rõ ràng",
      "options": {
        "A": "Lựa chọn A",
        "B": "Lựa chọn B",
        "C": "Lựa chọn C",
        "D": "Lựa chọn D"
      },
      "correctOption": "A",
      "explanation": "Giải thích ngắn gọn dựa trên summary/chunk"
    }
  ]
}

SUMMARY:
Key points:
${keyPoints.map((point, index) => `${index + 1}. ${point}`).join('\n')}

Main topics:
${mainTopics.map((topic, index) => `${index + 1}. ${topic}`).join('\n')}

Simplified text:
${summary.simplifiedText}

SOURCE_CHUNKS:
${evidence}`;
  }

  private buildRuleMiniTestQuestions(
    summary: SummaryInput,
    sourceChunks: SourceChunk[],
  ): MiniTestQuestion[] {
    const keyPoints = this.normalizeStringArray(summary.keyPoints);
    const mainTopics = this.normalizeStringArray(summary.mainTopics);
    const sentences = this.splitSentences(summary.simplifiedText);
    const sources = this.buildQuestionSources(
      keyPoints,
      mainTopics,
      sentences,
      sourceChunks,
    );
    const questions: MiniTestQuestion[] = [];

    for (let index = 0; index < this.totalQuestions; index += 1) {
      const source = sources[index % sources.length];
      questions.push(this.buildQuestion(source, index, sources));
    }

    return questions;
  }

  private buildQuestionSources(
    keyPoints: string[],
    mainTopics: string[],
    sentences: string[],
    sourceChunks: SourceChunk[],
  ): QuestionSource[] {
    const sources: QuestionSource[] = [
      ...sourceChunks.slice(0, 10).map((chunk) => ({
        kind: 'chunk' as const,
        text: chunk.content,
        sourceChunkId: chunk.id,
      })),
      ...keyPoints.map((text) => ({
        kind: 'keyPoint' as const,
        text,
        sourceChunkId: this.findMatchingChunkId(text, sourceChunks),
      })),
      ...mainTopics.map((text) => ({
        kind: 'topic' as const,
        text,
        sourceChunkId: this.findMatchingChunkId(text, sourceChunks),
      })),
      ...sentences.map((text) => ({
        kind: 'sentence' as const,
        text,
        sourceChunkId: this.findMatchingChunkId(text, sourceChunks),
      })),
    ].filter((source) => source.text.length > 0);

    if (sources.length > 0) {
      return this.dedupeSources(sources);
    }

    return [
      {
        kind: 'sentence',
        text: 'Nội dung chính của video',
        sourceChunkId: null,
      },
    ];
  }

  private buildQuestion(
    source: QuestionSource,
    index: number,
    allSources: QuestionSource[],
  ): MiniTestQuestion {
    const correctOption = this.pickCorrectOption(index);
    const correctAnswer = this.answerForSource(source);
    const distractors = this.buildDistractors(correctAnswer, index, allSources);
    const options = this.placeCorrectAnswer(
      correctOption,
      correctAnswer,
      distractors,
    );

    return {
      questionText: this.questionTextForSource(source, index),
      options,
      correctOption,
      explanation: this.explanationForSource(source, correctOption),
      questionIndex: index,
      sourceChunkId: source.sourceChunkId,
    };
  }

  private questionTextForSource(source: QuestionSource, index: number): string {
    if (source.kind === 'chunk') {
      return `Câu ${index + 1}: Ý nào sau đây được nêu trực tiếp trong transcript video?`;
    }

    if (source.kind === 'topic') {
      return `Câu ${index + 1}: Chủ đề nào được nhắc đến trong video?`;
    }

    if (source.kind === 'keyPoint') {
      return `Câu ${index + 1}: Ý nào sau đây là một ý chính của video?`;
    }

    return `Câu ${index + 1}: Nội dung nào phù hợp nhất với phần tóm tắt video?`;
  }

  private answerForSource(source: QuestionSource): string {
    return this.truncateWords(source.text, 28);
  }

  private explanationForSource(
    source: QuestionSource,
    correctOption: QuizOption,
  ): string {
    if (source.kind === 'chunk') {
      return `Đáp án ${correctOption} đúng vì nội dung này xuất hiện trực tiếp trong transcript video.`;
    }

    if (source.kind === 'topic') {
      return `Đáp án ${correctOption} đúng vì chủ đề này xuất hiện trong phần chủ đề chính của summary.`;
    }

    if (source.kind === 'keyPoint') {
      return `Đáp án ${correctOption} đúng vì đây là một ý chính được rút ra từ summary của video.`;
    }

    return `Đáp án ${correctOption} đúng vì nội dung này khớp với phần giải thích/tóm tắt của video.`;
  }

  private buildDistractors(
    correctAnswer: string,
    index: number,
    allSources: QuestionSource[],
  ): string[] {
    const candidates = allSources
      .map((source) => this.truncateWords(source.text, 22))
      .filter(
        (candidate) =>
          candidate.length > 0 &&
          this.normalizeForCompare(candidate) !==
            this.normalizeForCompare(correctAnswer),
      );

    const defaults = [
      'Một bước biến đổi không được transcript hỗ trợ',
      'Một kết luận không dựa trên nội dung đã học',
      'Một điều kiện áp dụng khác với nội dung video',
      'Một công thức không xuất hiện trong phần tóm tắt',
      'Một chủ đề khác với trọng tâm video',
    ];

    return this.uniqueOptions([
      ...candidates.slice(index, index + 3),
      ...candidates.slice(0, 3),
      ...defaults,
    ]).slice(0, 3);
  }

  private placeCorrectAnswer(
    correctOption: QuizOption,
    correctAnswer: string,
    distractors: string[],
  ): Record<QuizOption, string> {
    const letters: QuizOption[] = ['A', 'B', 'C', 'D'];
    const ordered = [...distractors];
    ordered.splice(letters.indexOf(correctOption), 0, correctAnswer);

    while (ordered.length < 4) {
      ordered.push('Một lựa chọn không có đủ bằng chứng trong video');
    }

    return {
      A: ordered[0],
      B: ordered[1],
      C: ordered[2],
      D: ordered[3],
    };
  }

  private buildChunkEvidence(sourceChunks: SourceChunk[]): string {
    let totalChars = 0;
    const evidence: string[] = [];

    for (const chunk of sourceChunks) {
      const content = this.truncateWords(chunk.content, 160);
      const entry = `[chunk ${chunk.chunkIndex}] ${content}`;

      if (totalChars + entry.length > this.aiQuizMaxChars) {
        break;
      }

      evidence.push(entry);
      totalChars += entry.length;
    }

    return evidence.join('\n\n');
  }

  private parseAiQuizQuestions(content: string): AiQuizQuestion[] {
    const jsonText = this.extractJsonObject(content);
    const parsed: unknown = JSON.parse(jsonText);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('questions' in parsed) ||
      !Array.isArray(parsed.questions)
    ) {
      throw new Error('AI quiz response does not match the expected schema.');
    }

    return parsed.questions
      .map((question) => this.parseAiQuizQuestion(question))
      .filter((question): question is AiQuizQuestion => question !== null)
      .slice(0, this.totalQuestions);
  }

  private parseAiQuizQuestion(value: unknown): AiQuizQuestion | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const questionText =
      typeof record.questionText === 'string' ? record.questionText.trim() : '';
    const explanation =
      typeof record.explanation === 'string' ? record.explanation.trim() : '';
    const correctOption = this.parseQuizOption(record.correctOption);
    const options = this.parseAiOptions(record.options);

    if (!questionText || !explanation || !correctOption || !options) {
      return null;
    }

    return {
      questionText,
      options,
      correctOption,
      explanation,
    };
  }

  private parseAiOptions(value: unknown): Record<QuizOption, string> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }

    const record = value as Record<string, unknown>;
    const options = {
      A: typeof record.A === 'string' ? record.A.trim() : '',
      B: typeof record.B === 'string' ? record.B.trim() : '',
      C: typeof record.C === 'string' ? record.C.trim() : '',
      D: typeof record.D === 'string' ? record.D.trim() : '',
    };

    if (!options.A || !options.B || !options.C || !options.D) {
      return null;
    }

    return options;
  }

  private parseQuizOption(value: unknown): QuizOption | null {
    if (value === 'A' || value === 'B' || value === 'C' || value === 'D') {
      return value;
    }

    return null;
  }

  private extractJsonObject(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      throw new Error('AI quiz response did not contain a JSON object.');
    }

    return text.slice(start, end + 1);
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

  private pickCorrectOption(index: number): QuizOption {
    const options: QuizOption[] = ['A', 'B', 'C', 'D'];
    return options[index % options.length];
  }

  private uniqueOptions(values: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];

    for (const value of values) {
      const normalized = this.normalizeForCompare(value);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      unique.push(value);
    }

    return unique;
  }

  private dedupeSources(sources: QuestionSource[]): QuestionSource[] {
    const seen = new Set<string>();
    const unique: QuestionSource[] = [];

    for (const source of sources) {
      const normalized = this.normalizeForCompare(source.text);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      unique.push(source);
    }

    return unique;
  }

  private findMatchingChunkId(
    text: string,
    chunks: SourceChunk[],
  ): string | null {
    const normalizedText = this.normalizeForCompare(text);

    if (!normalizedText) {
      return null;
    }

    const exact = chunks.find((chunk) =>
      this.normalizeForCompare(chunk.content).includes(normalizedText),
    );

    if (exact) {
      return exact.id;
    }

    const textTerms = new Set(
      normalizedText
        .split(/\s+/)
        .filter((term) => term.length >= 4)
        .slice(0, 12),
    );

    let bestChunkId: string | null = null;
    let bestOverlap = 0;

    for (const chunk of chunks) {
      const chunkText = this.normalizeForCompare(chunk.content);
      let overlap = 0;

      for (const term of textTerms) {
        if (chunkText.includes(term)) {
          overlap += 1;
        }
      }

      if (overlap > bestOverlap) {
        bestChunkId = chunk.id;
        bestOverlap = overlap;
      }
    }

    return bestOverlap > 0 ? bestChunkId : null;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  private splitSentences(text: string): string[] {
    const matches: string[] = text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [];

    return matches
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
  }

  private truncateWords(text: string, maxWords: number): string {
    const words = text.trim().split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) {
      return words.join(' ');
    }

    return words.slice(0, maxWords).join(' ') + '...';
  }

  private normalizeForCompare(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
