import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { GroqGatewayService } from '../groq-gateway/groq-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuizDto } from './dto/create-quiz.dto';
import { UpdateQuizDto } from './dto/update-quiz.dto';

type SummaryRecord = {
  keyPoints: unknown;
  simplifiedText: string;
  mainTopics: unknown;
  modelUsed: string | null;
};

type QuizQuestionInput = {
  questionText: string;
  options: Record<string, string>;
  correctOption: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  questionIndex: number;
};

type QuizSource = {
  label: string;
  answer: string;
  context: string;
};

type AiQuizQuestion = {
  questionText: string;
  options: Record<string, string>;
  correctOption: 'A' | 'B' | 'C' | 'D';
  explanation: string;
};

type AiQuizPayload = {
  title?: string;
  modelUsed?: string;
  questions: AiQuizQuestion[];
};

@Injectable()
export class QuizService {
  private readonly logger = new Logger(QuizService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly groqGateway: GroqGatewayService,
  ) {}

  async create(createQuizDto: CreateQuizDto) {
    try {
      return await this.prisma.quiz.create({
        data: createQuizDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createQuizDto.videoId);
    }
  }

  async createFromVideo(videoId: string) {
    const summary = await this.prisma.summary.findUnique({
      where: {
        videoId,
      },
    });

    if (!summary) {
      throw new NotFoundException('video không tồn tại');
    }

    const summaryRecord = summary as SummaryRecord;
    const quizData = await this.buildQuizDataFromSummary(
      videoId,
      summaryRecord,
    );

    return this.prisma.$transaction(async (tx) => {
      const createdQuiz = await tx.quiz.create({
        data: {
          videoId,
          title: quizData.title,
          totalQuestions: quizData.questions.length,
          modelUsed: quizData.modelUsed,
        },
      });

      await tx.quizQuestion.createMany({
        data: quizData.questions.map((question) => ({
          quizId: createdQuiz.id,
          questionText: question.questionText,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
          questionIndex: question.questionIndex,
        })),
      });

      return tx.quiz.findUnique({
        where: {
          id: createdQuiz.id,
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
    });

    if (!quiz) {
      throw new NotFoundException(`Quiz with id "${id}" not found`);
    }

    return quiz;
  }

  async update(id: string, updateQuizDto: UpdateQuizDto) {
    try {
      return await this.prisma.quiz.update({
        where: {
          id,
        },
        data: updateQuizDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.quiz.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  private async buildQuizDataFromSummary(
    videoId: string,
    summary: SummaryRecord,
  ) {
    const aiQuizData = await this.tryBuildAiQuizDataFromSummary(summary);
    if (aiQuizData) {
      const fallbackQuizData = this.buildRuleBasedQuizDataFromSummary(
        videoId,
        summary,
      );
      const questions = aiQuizData.questions
        .slice(0, 10)
        .map((question, index) => ({
          questionText: question.questionText,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
          questionIndex: index,
        }));

      while (questions.length < 10) {
        const fallbackQuestion = fallbackQuizData.questions[questions.length];
        if (!fallbackQuestion) {
          break;
        }

        questions.push({
          questionText: fallbackQuestion.questionText,
          options: fallbackQuestion.options,
          correctOption: fallbackQuestion.correctOption,
          explanation: fallbackQuestion.explanation,
          questionIndex: questions.length,
        });
      }

      return {
        title: aiQuizData.title ?? 'Quiz from summary',
        modelUsed: aiQuizData.modelUsed ?? 'ai-summary-mcq',
        questions,
      };
    }

    return this.buildRuleBasedQuizDataFromSummary(videoId, summary);
  }

  private buildRuleBasedQuizDataFromSummary(
    videoId: string,
    summary: SummaryRecord,
  ) {
    const keyPoints = this.normalizeStringArray(summary.keyPoints);
    const mainTopics = this.normalizeStringArray(summary.mainTopics);
    const simplifiedSentences = this.splitIntoSentences(summary.simplifiedText);

    const questionSources = this.buildQuestionSources(
      keyPoints,
      mainTopics,
      simplifiedSentences,
    );

    const questions = questionSources
      .slice(0, 10)
      .map((source, index) => this.buildMultipleChoiceQuestion(source, index));

    while (questions.length < 10) {
      const fallbackText =
        simplifiedSentences[
          questions.length % Math.max(simplifiedSentences.length, 1)
        ] ??
        summary.simplifiedText ??
        `Nội dung chính của video ${videoId}`;

      questions.push(
        this.buildMultipleChoiceQuestion(
          {
            label: fallbackText,
            answer: fallbackText,
            context: summary.simplifiedText,
          },
          questions.length,
        ),
      );
    }

    return {
      title: 'Quiz from summary',
      modelUsed: summary.modelUsed ?? 'summary-based-mcq',
      questions,
    };
  }

  private async tryBuildAiQuizDataFromSummary(summary: SummaryRecord) {
    if (!this.groqGateway.hasKeys()) {
      return null;
    }

    const modelCandidates = this.buildQuizModelCandidates();
    const primaryModel = modelCandidates[0];
    const fallbackModels = modelCandidates.slice(1);

    const result = await this.groqGateway.chatCompletion({
      model: primaryModel,
      fallbackModels,
      messages: this.buildAiQuizMessages(summary),
      maxTokens: 3200,
    });

    if (!result) {
      return null;
    }

    const parsed = this.parseAiQuizPayload(result.content);
    if (parsed) {
      return {
        ...parsed,
        modelUsed: parsed.modelUsed ?? result.modelUsed,
      };
    }

    return null;
  }

  private parseAiQuizPayload(content: string): AiQuizPayload | null {
    const jsonText = this.extractJsonFromText(content);

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const questions = Array.isArray(parsed.questions)
        ? parsed.questions
            .map((question) => this.normalizeAiQuizQuestion(question))
            .filter((question): question is AiQuizQuestion => question !== null)
        : [];

      if (questions.length === 0) {
        return null;
      }

      return {
        title:
          typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
        modelUsed:
          typeof parsed.modelUsed === 'string'
            ? parsed.modelUsed.trim()
            : undefined,
        questions,
      };
    } catch {
      return null;
    }
  }

  private normalizeAiQuizQuestion(value: unknown): AiQuizQuestion | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const questionText =
      typeof record.questionText === 'string' ? record.questionText.trim() : '';
    const explanation =
      typeof record.explanation === 'string' ? record.explanation.trim() : '';
    const correctOption = record.correctOption;
    const options = record.options;

    if (!questionText || !explanation) {
      return null;
    }

    if (
      correctOption !== 'A' &&
      correctOption !== 'B' &&
      correctOption !== 'C' &&
      correctOption !== 'D'
    ) {
      return null;
    }

    if (!options || typeof options !== 'object') {
      return null;
    }

    const optionRecord = options as Record<string, unknown>;
    const normalizedOptions = {
      A:
        typeof optionRecord.A === 'string'
          ? optionRecord.A.trim()
          : typeof optionRecord.a === 'string'
            ? optionRecord.a.trim()
            : '',
      B:
        typeof optionRecord.B === 'string'
          ? optionRecord.B.trim()
          : typeof optionRecord.b === 'string'
            ? optionRecord.b.trim()
            : '',
      C:
        typeof optionRecord.C === 'string'
          ? optionRecord.C.trim()
          : typeof optionRecord.c === 'string'
            ? optionRecord.c.trim()
            : '',
      D:
        typeof optionRecord.D === 'string'
          ? optionRecord.D.trim()
          : typeof optionRecord.d === 'string'
            ? optionRecord.d.trim()
            : '',
    };

    if (
      !normalizedOptions.A ||
      !normalizedOptions.B ||
      !normalizedOptions.C ||
      !normalizedOptions.D
    ) {
      return null;
    }

    return {
      questionText,
      options: normalizedOptions,
      correctOption,
      explanation,
    };
  }

  private extractJsonFromText(content: string) {
    const trimmed = content.trim();

    if (trimmed.startsWith('```')) {
      return trimmed
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return trimmed.slice(firstBrace, lastBrace + 1);
    }

    return trimmed;
  }

  private buildQuizModelCandidates() {
    return this.uniqueStrings([
      this.configService.get<string>('QUIZ_GENERATION_MODEL')?.trim(),
      this.configService.get<string>('GROQ_CHAT_MODEL')?.trim(),
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
    ]);
  }

  private uniqueStrings(values: Array<string | undefined | null>) {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
      const normalized = value?.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }

  private buildAiQuizMessages(summary: SummaryRecord) {
    return [
      {
        role: 'system',
        content: this.buildAiQuizSystemPrompt(),
      },
      {
        role: 'user',
        content: this.buildAiQuizUserPrompt(summary),
      },
    ];
  }

  private buildAiQuizSystemPrompt() {
    return [
      'Bạn là người biên soạn câu hỏi trắc nghiệm cho video học tập tiếng Việt, domain chính là toán học.',
      'Nhiệm vụ của bạn là biến summary thành câu hỏi tự nhiên, rõ nghĩa, và tuyệt đối không bịa dữ kiện ngoài summary.',
      'Chỉ được dùng thông tin đã xuất hiện trực tiếp trong summary: định nghĩa, công thức, ký hiệu, bước giải, nhận xét, ví dụ, kết luận, và mối quan hệ đã nêu rõ.',
      'Không tự thêm số liệu mới, không tự thay đổi giả thiết, không tự suy diễn công thức mới, không tự tạo bước giải không có trong summary.',
      'Nếu summary chưa đủ chi tiết cho câu hỏi tính toán, hãy ưu tiên câu hỏi về khái niệm, định nghĩa, nhận dạng công thức, hoặc vai trò của một bước trong lời giải.',
      'Hãy chia câu hỏi theo đúng dạng toán nếu summary cho phép nhận diện.',
      'Dạng đại số: chỉ hỏi về biểu thức, phương trình, bất phương trình, biến số, phép biến đổi, nhân tử, nghiệm, điều kiện, hoặc các bước giải đã nêu.',
      'Dạng hình học: chỉ hỏi về điểm, đoạn thẳng, góc, tam giác, tứ giác, đường tròn, quan hệ song song/vuông góc, định lý, chu vi, diện tích, hoặc dữ kiện hình học đã nêu.',
      'Dạng xác suất và thống kê: chỉ hỏi về biến cố, không gian mẫu, xác suất, tần số, trung bình, trung vị, mốt, hoặc cách tính đã nêu trong summary.',
      'Nếu summary không đủ để nhận diện rõ một dạng toán, hãy tạo câu hỏi tổng quát nhưng vẫn bám sát nội dung thật có trong summary.',
      'Mỗi câu hỏi phải kiểm tra đúng một ý riêng, không hỏi nhập nhằng, không ghép nhiều ý vào một câu.',
      'Distractors phải hợp lý, gần nghĩa, nhưng chỉ một đáp án đúng duy nhất và phải kiểm chứng được từ summary.',
      'Tránh lặp kiểu hỏi, tránh câu hỏi quá máy móc, tránh câu hỏi mà hai đáp án đều có thể đúng.',
      'Độ khó nên pha trộn: 3 câu dễ, 4 câu trung bình, 3 câu khó vừa, nhưng luôn bám sát dữ kiện có sẵn.',
      'Trả về CHỈ JSON hợp lệ, không markdown, không giải thích ngoài JSON.',
      'Schema bắt buộc:',
      '{"title":string,"modelUsed":string,"questions":[{"questionText":string,"options":{"A":string,"B":string,"C":string,"D":string},"correctOption":"A"|"B"|"C"|"D","explanation":string}]}',
      'Phải đúng 10 câu hỏi.',
    ].join(' ');
  }

  private buildAiQuizUserPrompt(summary: SummaryRecord) {
    return JSON.stringify({
      videoSummary: {
        keyPoints: this.normalizeStringArray(summary.keyPoints),
        simplifiedText: summary.simplifiedText,
        mainTopics: this.normalizeStringArray(summary.mainTopics),
      },
      instructions: {
        language: 'vi',
        totalQuestions: 10,
        style:
          'natural, specific, classroom-friendly, math-focused, domain-aware',
        truthRule: 'Only use facts explicitly present in the summary.',
        antiHallucinationRule:
          'Do not invent numbers, formulas, symbols, steps, shapes, events, or statistics not found in the summary.',
        coverage: [
          'algebra concepts, expressions, equations, variables, and solution steps if present',
          'geometry concepts, shapes, angles, lengths, areas, theorems, and relations if present',
          'probability and statistics concepts, sample spaces, events, probabilities, and measures if present',
          'definitions and interpretations explicitly mentioned in the summary',
          'solution steps or reasoning steps explicitly mentioned in the summary',
          'direct inference from the summary only',
        ],
        outputRules: [
          'Each question must be answerable from the summary only.',
          'If the summary does not contain enough detail for a computation question, ask about the concept, definition, or step instead.',
          'Do not introduce diagrams, formulas, or numerical values that are not explicitly in the summary.',
          'Keep options balanced in length and plausibility.',
          'Do not reuse the exact same wording across many questions.',
          'Use concise explanations that justify why the correct option is right using only summary content.',
        ],
      },
      outputExample: {
        title: 'Quiz từ summary',
        modelUsed: 'ai-summary-mcq',
        questions: [
          {
            questionText: '...',
            options: {
              A: '...',
              B: '...',
              C: '...',
              D: '...',
            },
            correctOption: 'A',
            explanation: '...',
          },
        ],
      },
    });
  }

  private buildQuestionSources(
    keyPoints: string[],
    mainTopics: string[],
    simplifiedSentences: string[],
  ): QuizSource[] {
    const sources: QuizSource[] = [];

    for (const point of keyPoints) {
      sources.push({
        label: point,
        answer: point,
        context: simplifiedSentences.join(' '),
      });
    }

    for (const topic of mainTopics) {
      sources.push({
        label: topic,
        answer: topic,
        context: simplifiedSentences.join(' '),
      });
    }

    for (const sentence of simplifiedSentences) {
      sources.push({
        label: sentence,
        answer: sentence,
        context: simplifiedSentences.join(' '),
      });
    }

    return sources.length > 0
      ? sources
      : [
          {
            label: 'Nội dung chính của video',
            answer: 'Nội dung chính của video',
            context: 'Nội dung chính của video',
          },
        ];
  }

  private buildMultipleChoiceQuestion(
    source: QuizSource,
    index: number,
  ): QuizQuestionInput {
    const correctOption = this.pickCorrectOption(index);
    const distractors = this.buildDistractors(source.answer, source.context);
    const options = this.buildOptions(
      correctOption,
      source.answer,
      distractors,
    );

    return {
      questionText: this.buildQuestionText(source.label, index),
      options,
      correctOption,
      explanation: `Đáp án đúng là ${correctOption} vì nội dung này được rút ra từ summary của video.`,
      questionIndex: index,
    };
  }

  private buildQuestionText(label: string, index: number) {
    const templates = [
      `Câu ${index + 1}: Ý nào phù hợp nhất với nội dung sau: ${label}?`,
      `Câu ${index + 1}: Nội dung nào đúng nhất về ý này: ${label}?`,
      `Câu ${index + 1}: Chọn đáp án mô tả đúng nhất: ${label}?`,
      `Câu ${index + 1}: Phần nào sau đây khớp với ý chính: ${label}?`,
    ];

    return templates[index % templates.length];
  }

  private buildDistractors(answer: string, context: string) {
    const baseWords = this.splitWords(`${answer} ${context}`);
    const fallbackWords = [
      'phân tích',
      'ngẫu nhiên',
      'ví dụ',
      'không liên quan',
    ];

    const distractors = [
      this.mutateAnswer(answer, baseWords[0] ?? fallbackWords[0]),
      this.mutateAnswer(answer, baseWords[1] ?? fallbackWords[1]),
      this.mutateAnswer(answer, baseWords[2] ?? fallbackWords[2]),
    ];

    return this.ensureUniqueAnswers([answer, ...distractors], fallbackWords);
  }

  private buildOptions(
    correctOption: 'A' | 'B' | 'C' | 'D',
    answer: string,
    distractors: string[],
  ) {
    const letters: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
    const ordered = [...distractors];
    const correctIndex = letters.indexOf(correctOption);
    ordered.splice(correctIndex, 0, answer);

    return {
      A: ordered[0],
      B: ordered[1],
      C: ordered[2],
      D: ordered[3],
    };
  }

  private pickCorrectOption(index: number): 'A' | 'B' | 'C' | 'D' {
    return ['A', 'B', 'C', 'D'][index % 4] as 'A' | 'B' | 'C' | 'D';
  }

  private mutateAnswer(answer: string, seed: string) {
    if (!answer.trim()) {
      return seed;
    }

    return `${seed} khác ${answer.slice(0, Math.min(12, answer.length))}`;
  }

  private ensureUniqueAnswers(values: string[], fallbacks: string[]) {
    const unique: string[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const normalized = this.normalizeForComparison(value);
      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      unique.push(value);
    }

    let fallbackIndex = 0;
    while (unique.length < 4) {
      const fallback = fallbacks[fallbackIndex % fallbacks.length];
      const normalized = this.normalizeForComparison(fallback);
      fallbackIndex += 1;

      if (!normalized || seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      unique.push(fallback);
    }

    return unique.slice(1, 4);
  }

  private normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  private splitIntoSentences(text: string) {
    return (
      text
        .match(/[^.!?]+[.!?]?/g)
        ?.map((sentence) => sentence.trim())
        .filter(Boolean) ?? []
    );
  }

  private splitWords(text: string) {
    return text.split(/\s+/).filter(Boolean);
  }

  private normalizeForComparison(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        throw new NotFoundException(`Video with id "${id}" not found`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Quiz with id "${id}" not found`);
      }
    }

    throw error;
  }
}
