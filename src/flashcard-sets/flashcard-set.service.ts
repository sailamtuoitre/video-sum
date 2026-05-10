import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { ChunkService } from '../chunks/chunk.service';
import { GroqGatewayService } from '../groq-gateway/groq-gateway.service';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../summaries/summary.service';
import { CreateFlashcardSetDto } from './dto/create-flashcard-set.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcard-set.dto';

type SummaryRecord = {
  keyPoints: unknown;
  simplifiedText: string;
  mainTopics: unknown;
  modelUsed: string | null;
};

type ChunkRecord = {
  id: string;
  content: string;
  chunkIndex: number;
  tokenCount: number | null;
  startChar: number | null;
  endChar: number | null;
};

type VideoBundle = {
  videoId: string;
  videoTitle: string;
  summary: SummaryRecord;
  chunks: ChunkRecord[];
};

type ProjectBundle = {
  projectId: string;
  projectName: string;
  projectDescription: string | null;
  videos: VideoBundle[];
};

type FlashcardSource = {
  front: string;
  back: string;
  sourceChunkId?: string;
  sourceChunkIndex?: number;
};

type AiFlashcardCard = FlashcardSource;

type AiFlashcardPayload = {
  title?: string;
  modelUsed?: string;
  cards: AiFlashcardCard[];
};

type FlashcardGenerationResult = {
  title: string;
  modelUsed: string;
  cards: FlashcardSource[];
};

type FlashcardStudyStatus = 'pending' | 'known' | 'unknown';

type FlashcardStudyProgressRecord = {
  flashcardId: string;
  status: FlashcardStudyStatus;
  reviewCount: number;
  lastReviewedAt: Date | null;
};

type FlashcardStudyCard = {
  id: string;
  cardIndex: number;
  front: string;
  back: string;
  sourceChunkId: string | null;
  status: FlashcardStudyStatus;
  reviewCount: number;
  lastReviewedAt: Date | null;
  isCurrent: boolean;
};

type FlashcardStudyState = {
  id: string;
  title: string | null;
  videoId: string | null;
  projectId: string | null;
  totalCards: number;
  modelUsed: string | null;
  completed: boolean;
  currentCard: FlashcardStudyCard | null;
  stats: {
    known: number;
    unknown: number;
    remaining: number;
    reviewed: number;
    total: number;
  };
  cards: FlashcardStudyCard[];
};

@Injectable()
export class FlashcardSetService {
  private readonly logger = new Logger(FlashcardSetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
    private readonly summaryService: SummaryService,
    private readonly configService: ConfigService,
    private readonly groqGateway: GroqGatewayService,
  ) {}

  async create(createFlashcardSetDto: CreateFlashcardSetDto) {
    this.assertFlashcardSetScope(
      createFlashcardSetDto.videoId,
      createFlashcardSetDto.projectId,
    );

    try {
      return await this.prisma.flashcardSet.create({
        data: createFlashcardSetDto,
      });
    } catch (error) {
      this.handlePrismaError(
        error,
        createFlashcardSetDto.videoId ?? createFlashcardSetDto.projectId,
      );
    }
  }

  async createFromVideo(videoId: string) {
    const bundle = await this.loadVideoBundle(videoId);
    const flashcardData = await this.buildFlashcardDataFromVideo(bundle);
    return this.persistFlashcardSet({
      videoId,
      title: flashcardData.title,
      modelUsed: flashcardData.modelUsed,
      cards: flashcardData.cards,
    });
  }

  async createFromProject(projectId: string) {
    const project = await this.loadProject(projectId);
    const bundles = await this.loadProjectBundles(project);

    if (bundles.length === 0) {
      throw new NotFoundException(
        `No processed videos found for project with id "${projectId}"`,
      );
    }

    const flashcardData = await this.buildFlashcardDataFromProject(
      project,
      bundles,
    );

    return this.persistFlashcardSet({
      projectId,
      title: flashcardData.title,
      modelUsed: flashcardData.modelUsed,
      cards: flashcardData.cards,
    });
  }

  findAll(videoId?: string, projectId?: string) {
    return this.prisma.flashcardSet.findMany({
      where: {
        ...(videoId ? { videoId } : {}),
        ...(projectId ? { projectId } : {}),
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        flashcards: {
          orderBy: {
            cardIndex: 'asc',
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const flashcardSet = await this.prisma.flashcardSet.findUnique({
      where: {
        id,
      },
      include: {
        flashcards: {
          orderBy: {
            cardIndex: 'asc',
          },
        },
      },
    });

    if (!flashcardSet) {
      throw new NotFoundException(`FlashcardSet with id "${id}" not found`);
    }

    return flashcardSet;
  }

  async update(id: string, updateFlashcardSetDto: UpdateFlashcardSetDto) {
    try {
      return await this.prisma.flashcardSet.update({
        where: {
          id,
        },
        data: updateFlashcardSetDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.flashcardSet.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async getStudyState(id: string) {
    const flashcardSet = await this.loadStudySet(id);
    return this.buildStudyState(flashcardSet);
  }

  async reviewCard(
    id: string,
    reviewFlashcardCardDto: {
      flashcardId: string;
      status: FlashcardStudyStatus;
    },
  ) {
    const flashcardSet = await this.loadStudySet(id);
    const flashcard = flashcardSet.flashcards.find(
      (card) => card.id === reviewFlashcardCardDto.flashcardId,
    );

    if (!flashcard) {
      throw new NotFoundException(
        `Flashcard with id "${reviewFlashcardCardDto.flashcardId}" not found in set "${id}"`,
      );
    }

    await this.prisma.flashcardStudyProgress.upsert({
      where: {
        setId_flashcardId: {
          setId: id,
          flashcardId: flashcard.id,
        },
      },
      create: {
        setId: id,
        flashcardId: flashcard.id,
        status: reviewFlashcardCardDto.status,
        reviewCount: 1,
        lastReviewedAt: new Date(),
      },
      update: {
        status: reviewFlashcardCardDto.status,
        reviewCount: {
          increment: 1,
        },
        lastReviewedAt: new Date(),
      },
    });

    return this.getStudyState(id);
  }

  async resetStudy(id: string) {
    await this.loadStudySet(id);
    await this.prisma.flashcardStudyProgress.deleteMany({
      where: {
        setId: id,
      },
    });

    return this.getStudyState(id);
  }

  private async persistFlashcardSet(input: {
    videoId?: string;
    projectId?: string;
    title: string;
    modelUsed: string;
    cards: FlashcardSource[];
  }) {
    const cards = this.normalizeCards(input.cards).slice(0, 20);
    if (cards.length === 0) {
      throw new NotFoundException('Unable to generate flashcards');
    }

    return this.prisma.$transaction(async (tx) => {
      const createdSet = await tx.flashcardSet.create({
        data: {
          videoId: input.videoId,
          projectId: input.projectId,
          title: input.title,
          totalCards: cards.length,
          modelUsed: input.modelUsed,
        },
      });

      await tx.flashcard.createMany({
        data: cards.map((card, index) => ({
          setId: createdSet.id,
          front: card.front,
          back: card.back,
          cardIndex: index,
          sourceChunkId: card.sourceChunkId ?? null,
        })),
      });

      return tx.flashcardSet.findUnique({
        where: {
          id: createdSet.id,
        },
        include: {
          flashcards: {
            orderBy: {
              cardIndex: 'asc',
            },
          },
        },
      });
    });
  }

  private async loadStudySet(id: string) {
    const flashcardSet = await this.prisma.flashcardSet.findUnique({
      where: {
        id,
      },
      include: {
        flashcards: {
          orderBy: {
            cardIndex: 'asc',
          },
        },
        studyProgress: true,
      },
    });

    if (!flashcardSet) {
      throw new NotFoundException(`FlashcardSet with id "${id}" not found`);
    }

    return flashcardSet;
  }

  private buildStudyState(flashcardSet: {
    id: string;
    title: string | null;
    videoId: string | null;
    projectId: string | null;
    totalCards: number;
    modelUsed: string | null;
    flashcards: Array<{
      id: string;
      cardIndex: number;
      front: string;
      back: string;
      sourceChunkId: string | null;
    }>;
    studyProgress: Array<{
      flashcardId: string;
      status: unknown;
      reviewCount: number;
      lastReviewedAt: Date | null;
    }>;
  }) {
    const progressMap = new Map<string, FlashcardStudyProgressRecord>();
    for (const progress of flashcardSet.studyProgress) {
      progressMap.set(progress.flashcardId, {
        flashcardId: progress.flashcardId,
        status: progress.status as FlashcardStudyStatus,
        reviewCount: progress.reviewCount,
        lastReviewedAt: progress.lastReviewedAt,
      });
    }

    const cards = flashcardSet.flashcards.map((card) => {
      const progress = progressMap.get(card.id);
      return {
        id: card.id,
        cardIndex: card.cardIndex,
        front: card.front,
        back: card.back,
        sourceChunkId: card.sourceChunkId,
        status: progress?.status ?? 'pending',
        reviewCount: progress?.reviewCount ?? 0,
        lastReviewedAt: progress?.lastReviewedAt ?? null,
        isCurrent: false,
      };
    });

    const currentIndex = cards.findIndex((card) => card.status === 'pending');
    if (currentIndex !== -1) {
      cards[currentIndex] = {
        ...cards[currentIndex],
        isCurrent: true,
      };
    }

    const currentCard = currentIndex !== -1 ? cards[currentIndex] : null;
    const known = cards.filter((card) => card.status === 'known').length;
    const unknown = cards.filter((card) => card.status === 'unknown').length;
    const remaining = cards.filter((card) => card.status === 'pending').length;

    return {
      id: flashcardSet.id,
      title: flashcardSet.title,
      videoId: flashcardSet.videoId,
      projectId: flashcardSet.projectId,
      totalCards: flashcardSet.totalCards,
      modelUsed: flashcardSet.modelUsed,
      completed: remaining === 0,
      currentCard,
      stats: {
        known,
        unknown,
        remaining,
        reviewed: known + unknown,
        total: cards.length,
      },
      cards,
    };
  }

  private async loadVideoBundle(
    videoId: string,
    customTitle?: string,
  ): Promise<VideoBundle> {
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
        `No transcript found for video with id "${videoId}"`,
      );
    }

    const chunks = await this.chunkService.ensureTranscriptChunks(
      videoId,
      transcript.id,
      transcript.rawText,
    );
    const summary = await this.ensureSummary(videoId);

    return {
      videoId,
      videoTitle:
        video.title?.trim() || customTitle?.trim() || `Video ${videoId}`,
      summary,
      chunks: chunks.map((chunk) => ({
        id: chunk.id,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
      })),
    };
  }

  private async loadProject(projectId: string): Promise<ProjectBundle> {
    const project = await this.prisma.project.findUnique({
      where: {
        id: projectId,
      },
      select: {
        id: true,
        name: true,
        description: true,
        videos: {
          orderBy: {
            createdAt: 'asc',
          },
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with id "${projectId}" not found`);
    }

    const bundles: VideoBundle[] = [];
    for (const video of project.videos) {
      try {
        bundles.push(
          await this.loadVideoBundle(video.id, video.title ?? undefined),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'unknown video load error';
        this.logger.warn(
          `Skipping video "${video.id}" while building project flashcards: ${message}`,
        );
      }
    }

    return {
      projectId: project.id,
      projectName: project.name,
      projectDescription: project.description,
      videos: bundles,
    };
  }

  private async loadProjectBundles(project: ProjectBundle) {
    return project.videos;
  }

  private async ensureSummary(videoId: string): Promise<SummaryRecord> {
    const existingSummary = await this.prisma.summary.findUnique({
      where: {
        videoId,
      },
    });

    if (existingSummary) {
      return existingSummary;
    }

    const summary = await this.summaryService.createFromVideo(videoId);
    return summary;
  }

  private async buildFlashcardDataFromVideo(
    bundle: VideoBundle,
  ): Promise<FlashcardGenerationResult> {
    const aiFlashcards = await this.tryBuildAiFlashcardsFromVideo(bundle);
    const fallbackData = this.buildRuleBasedFlashcardsFromVideo(bundle);

    if (aiFlashcards) {
      return this.mergeCardSources({
        title: aiFlashcards.title ?? `Flashcards from ${bundle.videoTitle}`,
        modelUsed: aiFlashcards.modelUsed ?? 'ai-summary-flashcards',
        primaryCards: aiFlashcards.cards,
        fallbackCards: fallbackData.cards,
        maxCards: 20,
        chunkLookup: bundle.chunks,
      });
    }

    return fallbackData;
  }

  private async buildFlashcardDataFromProject(
    project: ProjectBundle,
    bundles: VideoBundle[],
  ): Promise<FlashcardGenerationResult> {
    const aiFlashcards = await this.tryBuildAiFlashcardsFromProject(
      project,
      bundles,
    );
    const fallbackData = this.buildRuleBasedFlashcardsFromProject(
      project,
      bundles,
    );

    if (aiFlashcards) {
      return this.mergeCardSources({
        title:
          aiFlashcards.title ??
          `Flashcards from project ${project.projectName}`,
        modelUsed: aiFlashcards.modelUsed ?? 'ai-project-flashcards',
        primaryCards: aiFlashcards.cards,
        fallbackCards: fallbackData.cards,
        maxCards: 20,
        chunkLookup: bundles.flatMap((bundle) => bundle.chunks),
      });
    }

    return fallbackData;
  }

  private buildRuleBasedFlashcardsFromVideo(
    bundle: VideoBundle,
  ): FlashcardGenerationResult {
    const sources = this.buildVideoCardSources(bundle);
    const cards = this.normalizeCards(sources).slice(0, 20);

    return {
      title: `Flashcards from ${bundle.videoTitle}`,
      modelUsed: bundle.summary.modelUsed ?? 'summary-based-flashcards',
      cards: this.ensureMinimumCards(cards, bundle.videoTitle, bundle.summary),
    };
  }

  private buildRuleBasedFlashcardsFromProject(
    project: ProjectBundle,
    bundles: VideoBundle[],
  ): FlashcardGenerationResult {
    const projectSources: FlashcardSource[] = [];

    if (project.projectDescription?.trim()) {
      projectSources.push({
        front: `Project "${project.projectName}" nói về gì?`,
        back: project.projectDescription.trim(),
      });
    }

    const allKeyPoints = this.uniqueStrings(
      bundles.flatMap((bundle) =>
        this.normalizeStringArray(bundle.summary.keyPoints),
      ),
    );
    for (const keyPoint of allKeyPoints) {
      projectSources.push({
        front: `Ý chính xuyên suốt project là gì? ${this.truncateWords(keyPoint, 12)}?`,
        back: keyPoint,
      });
    }

    const allTopics = this.uniqueStrings(
      bundles.flatMap((bundle) =>
        this.normalizeStringArray(bundle.summary.mainTopics),
      ),
    );
    for (const topic of allTopics) {
      projectSources.push({
        front: `Chủ đề quan trọng nào xuất hiện trong project? ${this.truncateWords(topic, 12)}?`,
        back: topic,
      });
    }

    for (const bundle of bundles) {
      projectSources.push(...this.buildVideoCardSources(bundle));
    }

    const cards = this.normalizeCards(projectSources).slice(0, 20);
    return {
      title: `Flashcards from project ${project.projectName}`,
      modelUsed: 'project-summary-based-flashcards',
      cards: this.ensureMinimumProjectCards(cards, project, bundles),
    };
  }

  private buildVideoCardSources(bundle: VideoBundle) {
    const keyPoints = this.normalizeStringArray(bundle.summary.keyPoints);
    const mainTopics = this.normalizeStringArray(bundle.summary.mainTopics);
    const simplifiedSentences = this.splitIntoSentences(
      bundle.summary.simplifiedText,
    );

    const sources: FlashcardSource[] = [];

    for (const point of keyPoints) {
      sources.push({
        front: `Ý chính trong "${bundle.videoTitle}" là gì?`,
        back: point,
      });
    }

    for (const topic of mainTopics) {
      sources.push({
        front: `Khái niệm/chủ đề "${bundle.videoTitle}" nhắc đến là gì?`,
        back: topic,
      });
    }

    for (const sentence of simplifiedSentences) {
      sources.push({
        front: `Nội dung quan trọng nào được nói trong "${bundle.videoTitle}"?`,
        back: sentence,
      });
    }

    for (const chunk of bundle.chunks) {
      sources.push({
        front: `Đoạn ${chunk.chunkIndex + 1} của "${bundle.videoTitle}" nói gì?`,
        back: this.buildChunkDigest(chunk.content),
        sourceChunkId: chunk.id,
        sourceChunkIndex: chunk.chunkIndex,
      });
    }

    return sources;
  }

  private ensureMinimumCards(
    cards: FlashcardSource[],
    videoTitle: string,
    summary: SummaryRecord,
  ) {
    const result = [...cards];
    const fallbackText =
      this.splitIntoSentences(summary.simplifiedText)[0] ??
      summary.simplifiedText ??
      `Nội dung chính của video ${videoTitle}`;

    while (result.length < 20) {
      result.push({
        front: `Nhớ lại nội dung của "${videoTitle}" (${result.length + 1})?`,
        back: fallbackText,
      });
    }

    return this.normalizeCards(result).slice(0, 20);
  }

  private ensureMinimumProjectCards(
    cards: FlashcardSource[],
    project: ProjectBundle,
    bundles: VideoBundle[],
  ) {
    const result = [...cards];
    const projectSummaryText =
      project.projectDescription?.trim() ||
      bundles
        .flatMap((bundle) =>
          this.splitIntoSentences(bundle.summary.simplifiedText),
        )
        .slice(0, 2)
        .join(' ') ||
      `Project ${project.projectName}`;

    while (result.length < 20) {
      result.push({
        front: `Nhớ lại nội dung của project "${project.projectName}" (${result.length + 1})?`,
        back: projectSummaryText,
      });
    }

    return this.normalizeCards(result).slice(0, 20);
  }

  private async tryBuildAiFlashcardsFromVideo(bundle: VideoBundle) {
    if (!this.groqGateway.hasKeys()) {
      return null;
    }

    const modelCandidates = this.buildFlashcardModelCandidates();
    const primaryModel = modelCandidates[0];
    const fallbackModels = modelCandidates.slice(1);

    const result = await this.groqGateway.chatCompletion({
      model: primaryModel,
      fallbackModels,
      messages: this.buildAiFlashcardMessagesForVideo(bundle),
      maxTokens: 4000,
      maxRetriesPerModel: 2,
    });

    if (!result) {
      return null;
    }

    const parsed = this.parseAiFlashcardPayload(result.content);
    if (parsed) {
      return {
        ...parsed,
        modelUsed: parsed.modelUsed ?? result.modelUsed,
      };
    }

    return null;
  }

  private async tryBuildAiFlashcardsFromProject(
    project: ProjectBundle,
    bundles: VideoBundle[],
  ) {
    if (!this.groqGateway.hasKeys()) {
      return null;
    }

    const modelCandidates = this.buildFlashcardModelCandidates();
    const primaryModel = modelCandidates[0];
    const fallbackModels = modelCandidates.slice(1);

    const result = await this.groqGateway.chatCompletion({
      model: primaryModel,
      fallbackModels,
      messages: this.buildAiFlashcardMessagesForProject(project, bundles),
      maxTokens: 4000,
      maxRetriesPerModel: 2,
    });

    if (!result) {
      return null;
    }

    const parsed = this.parseAiFlashcardPayload(result.content);
    if (parsed) {
      return {
        ...parsed,
        modelUsed: parsed.modelUsed ?? result.modelUsed,
      };
    }

    return null;
  }

  private buildAiFlashcardMessagesForVideo(bundle: VideoBundle) {
    return [
      {
        role: 'system',
        content: this.buildAiFlashcardSystemPrompt(),
      },
      {
        role: 'user',
        content: this.buildAiFlashcardUserPromptForVideo(bundle),
      },
    ];
  }

  private buildAiFlashcardMessagesForProject(
    project: ProjectBundle,
    bundles: VideoBundle[],
  ) {
    return [
      {
        role: 'system',
        content: this.buildAiFlashcardSystemPrompt(),
      },
      {
        role: 'user',
        content: this.buildAiFlashcardUserPromptForProject(project, bundles),
      },
    ];
  }

  private buildAiFlashcardSystemPrompt() {
    return [
      'Bạn là người tạo flashcard học tập từ transcript video đã xử lý.',
      'Chỉ được dùng dữ kiện xuất hiện trong summary và chunks được cung cấp.',
      'Không được bịa thêm thông tin.',
      'Mỗi flashcard phải có front ngắn gọn, back rõ ràng, dễ học thuộc.',
      'Flashcard nên ưu tiên kiểm tra ghi nhớ, định nghĩa, mối quan hệ, quy trình, ý chính, hoặc chi tiết quan trọng.',
      'Nếu dữ kiện không đủ cho câu hỏi khó, hãy tạo flashcard khái quát nhưng vẫn bám sát nội dung thật.',
      'Trả về CHỈ JSON hợp lệ, không markdown, không giải thích ngoài JSON.',
      'Schema bắt buộc:',
      '{"title":string,"modelUsed":string,"cards":[{"front":string,"back":string,"sourceChunkId":string,"sourceChunkIndex":number}]}',
      'Phải đúng 20 flashcard nếu có thể.',
    ].join(' ');
  }

  private buildAiFlashcardUserPromptForVideo(bundle: VideoBundle) {
    return JSON.stringify({
      scope: 'video',
      videoId: bundle.videoId,
      videoTitle: bundle.videoTitle,
      videoSummary: {
        keyPoints: this.normalizeStringArray(bundle.summary.keyPoints),
        simplifiedText: bundle.summary.simplifiedText,
        mainTopics: this.normalizeStringArray(bundle.summary.mainTopics),
      },
      chunks: this.sampleChunks(bundle.chunks, 15).map((chunk) => ({
        chunkId: chunk.id,
        chunkIndex: chunk.chunkIndex,
        text: this.buildChunkDigest(chunk.content),
      })),
      instructions: {
        language: 'vi',
        totalCards: 20,
        style:
          'short front, clear back, study-oriented, specific, grounded in source text',
        outputRules: [
          'Every card must be answerable from the provided summary/chunks only.',
          'Front should be concise and ask about one idea only.',
          'Back should be short but informative.',
          'Use sourceChunkIndex or sourceChunkId to point to the most relevant chunk.',
          'Avoid duplicate or near-duplicate cards.',
          'Mix definitions, key ideas, examples, and process recall.',
        ],
      },
    });
  }

  private buildAiFlashcardUserPromptForProject(
    project: ProjectBundle,
    bundles: VideoBundle[],
  ) {
    return JSON.stringify({
      scope: 'project',
      projectId: project.projectId,
      projectName: project.projectName,
      projectDescription: project.projectDescription,
      videos: bundles.map((bundle) => ({
        videoId: bundle.videoId,
        videoTitle: bundle.videoTitle,
        summary: {
          keyPoints: this.normalizeStringArray(bundle.summary.keyPoints),
          simplifiedText: bundle.summary.simplifiedText,
          mainTopics: this.normalizeStringArray(bundle.summary.mainTopics),
        },
        chunks: this.sampleChunks(bundle.chunks, 8).map((chunk) => ({
          chunkId: chunk.id,
          chunkIndex: chunk.chunkIndex,
          text: this.buildChunkDigest(chunk.content),
        })),
      })),
      instructions: {
        language: 'vi',
        totalCards: 20,
        style:
          'short front, clear back, study-oriented, specific, grounded in source text',
        outputRules: [
          'Generate flashcards that cover the entire project, not only one video.',
          'Use the provided chunkId when setting sourceChunkId.',
          'If a card is project-level and not tied to one chunk, sourceChunkId may be omitted.',
          'Avoid duplicate or near-duplicate cards.',
          'Mix project overview, cross-video connections, definitions, and chunk-specific recall.',
        ],
      },
    });
  }

  private mergeCardSources(input: {
    title: string;
    modelUsed: string;
    primaryCards: FlashcardSource[];
    fallbackCards: FlashcardSource[];
    maxCards: number;
    chunkLookup: ChunkRecord[];
  }): FlashcardGenerationResult {
    const primary = this.normalizeCards(input.primaryCards);
    const fallback = this.normalizeCards(input.fallbackCards);
    const merged: FlashcardSource[] = [];
    const seen = new Set<string>();

    const addCard = (card: FlashcardSource) => {
      const key = this.cardDedupKey(card);
      if (!card.front || !card.back || seen.has(key)) {
        return;
      }

      seen.add(key);
      merged.push(card);
    };

    for (const card of primary) {
      addCard(card);
      if (merged.length >= input.maxCards) {
        break;
      }
    }

    for (const card of fallback) {
      if (merged.length >= input.maxCards) {
        break;
      }

      addCard(card);
    }

    return {
      title: input.title,
      modelUsed: input.modelUsed,
      cards: this.fillToMinimumCards(
        merged.slice(0, input.maxCards),
        input.chunkLookup,
      ),
    };
  }

  private fillToMinimumCards(
    cards: FlashcardSource[],
    chunks: ChunkRecord[],
  ): FlashcardSource[] {
    const result = [...cards];
    let cursor = 0;

    while (result.length < 20 && chunks.length > 0) {
      const chunk = chunks[cursor % chunks.length];
      result.push({
        front: `Đoạn ${chunk.chunkIndex + 1} nói gì? (${result.length + 1})`,
        back: this.buildChunkDigest(chunk.content),
        sourceChunkId: chunk.id,
        sourceChunkIndex: chunk.chunkIndex,
      });
      cursor += 1;
    }

    return this.normalizeCards(result).slice(0, 20);
  }

  private buildFlashcardModelCandidates() {
    return this.uniqueStrings([
      this.configService.get<string>('FLASHCARD_GENERATION_MODEL')?.trim(),
      this.configService.get<string>('GROQ_CHAT_MODEL')?.trim(),
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
    ]);
  }

  private sampleChunks(chunks: ChunkRecord[], maxChunks: number) {
    if (chunks.length <= maxChunks) {
      return chunks;
    }

    const sampled: ChunkRecord[] = [];
    const step = (chunks.length - 1) / (maxChunks - 1);

    for (let i = 0; i < maxChunks; i++) {
      sampled.push(chunks[Math.round(i * step)]);
    }

    return sampled;
  }

  private buildChunkDigest(content: string) {
    const sentences = this.splitIntoSentences(content);
    if (sentences.length > 0) {
      return sentences.slice(0, 2).join(' ').trim();
    }

    return this.truncateWords(content, 36);
  }

  private findChunkIdByIndex(chunks: ChunkRecord[], chunkIndex: number) {
    return chunks.find((chunk) => chunk.chunkIndex === chunkIndex)?.id;
  }

  private normalizeCards(cards: FlashcardSource[]) {
    const result: FlashcardSource[] = [];
    for (const card of cards) {
      const front = card.front.trim();
      const back = card.back.trim();
      if (!front || !back) {
        continue;
      }

      result.push({
        front,
        back,
        ...(card.sourceChunkId ? { sourceChunkId: card.sourceChunkId } : {}),
        ...(card.sourceChunkIndex !== undefined
          ? { sourceChunkIndex: card.sourceChunkIndex }
          : {}),
      });
    }

    return this.dedupeCards(result);
  }

  private dedupeCards(cards: FlashcardSource[]) {
    const seen = new Set<string>();
    const result: FlashcardSource[] = [];

    for (const card of cards) {
      const key = this.cardDedupKey(card);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(card);
    }

    return result;
  }

  private cardDedupKey(card: FlashcardSource) {
    return `${this.normalizeKey(card.front)}|${this.normalizeKey(card.back)}`;
  }

  private normalizeKey(text: string) {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  private truncateWords(text: string, maxWords: number) {
    const words = text.split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(' ');
  }

  private splitIntoSentences(text: string) {
    return (
      text
        .match(/[^.!?]+[.!?]?/g)
        ?.map((sentence) => sentence.trim())
        .filter(Boolean) ?? []
    );
  }

  private normalizeStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  private parseAiFlashcardPayload(content: string): AiFlashcardPayload | null {
    const jsonText = this.extractJsonFromText(content);

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const cards = Array.isArray(parsed.cards)
        ? parsed.cards
            .map((card) => this.normalizeAiFlashcardCard(card))
            .filter((card): card is AiFlashcardCard => card !== null)
        : [];

      if (cards.length === 0) {
        return null;
      }

      return {
        title:
          typeof parsed.title === 'string' ? parsed.title.trim() : undefined,
        modelUsed:
          typeof parsed.modelUsed === 'string'
            ? parsed.modelUsed.trim()
            : undefined,
        cards,
      };
    } catch {
      return null;
    }
  }

  private normalizeAiFlashcardCard(value: unknown): AiFlashcardCard | null {
    if (!value || typeof value !== 'object') {
      return null;
    }

    const record = value as Record<string, unknown>;
    const front = typeof record.front === 'string' ? record.front.trim() : '';
    const back = typeof record.back === 'string' ? record.back.trim() : '';
    const sourceChunkId =
      typeof record.sourceChunkId === 'string'
        ? record.sourceChunkId.trim()
        : typeof record.sourceChunkId === 'number'
          ? String(record.sourceChunkId)
          : undefined;
    const sourceChunkIndex =
      typeof record.sourceChunkIndex === 'number'
        ? record.sourceChunkIndex
        : typeof record.sourceChunkIndex === 'string' &&
            Number.isFinite(Number(record.sourceChunkIndex))
          ? Number(record.sourceChunkIndex)
          : undefined;

    if (!front || !back) {
      return null;
    }

    return {
      front,
      back,
      ...(sourceChunkId ? { sourceChunkId } : {}),
      ...(sourceChunkIndex !== undefined ? { sourceChunkIndex } : {}),
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

  private assertFlashcardSetScope(videoId?: string, projectId?: string) {
    if (!videoId && !projectId) {
      throw new BadRequestException(
        'Either videoId or projectId must be provided',
      );
    }
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        throw new NotFoundException(
          `Related video, project, or chunk not found`,
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`FlashcardSet with id "${id}" not found`);
      }
    }

    throw error;
  }
}
