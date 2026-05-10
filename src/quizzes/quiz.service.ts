import { Injectable, NotFoundException } from '@nestjs/common';
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

type MiniTestQuestion = {
  questionText: string;
  options: Record<QuizOption, string>;
  correctOption: QuizOption;
  explanation: string;
  questionIndex: number;
  sourceChunkId: string | null;
};

type QuestionSource = {
  kind: 'chunk' | 'keyPoint' | 'topic' | 'sentence';
  text: string;
  sourceChunkId: string | null;
};

@Injectable()
export class QuizService {
  private readonly totalQuestions = 10;

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
    const questions = this.buildMiniTestQuestions(summary, sourceChunks);

    return this.prisma.$transaction(async (tx) => {
      const quiz = await tx.quiz.create({
        data: {
          videoId,
          title: video.title ? `Mini test: ${video.title}` : 'Mini test',
          totalQuestions: questions.length,
          modelUsed: 'summary-rule-minitest-v1',
        },
      });

      await tx.quizQuestion.createMany({
        data: questions.map((question) => ({
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

  private buildMiniTestQuestions(
    summary: SummaryInput,
    sourceChunks: Awaited<ReturnType<PrismaService['chunk']['findMany']>>,
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
    sourceChunks: Awaited<ReturnType<PrismaService['chunk']['findMany']>>,
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
      return `Câu ${index + 1}: Nội dung nào được transcript video hỗ trợ rõ ràng nhất?`;
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
      return `Đáp án ${correctOption} đúng vì nội dung này được hỗ trợ trực tiếp bởi một chunk transcript của video.`;
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
      'Một nội dung không được nêu trong summary',
      'Một bước giải không liên quan đến video',
      'Một kết luận không dựa trên nội dung đã học',
      'Một ví dụ nằm ngoài phần tóm tắt',
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
      ordered.push(`Lựa chọn phụ ${ordered.length + 1}`);
    }

    return {
      A: ordered[0],
      B: ordered[1],
      C: ordered[2],
      D: ordered[3],
    };
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
    chunks: Awaited<ReturnType<PrismaService['chunk']['findMany']>>,
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
