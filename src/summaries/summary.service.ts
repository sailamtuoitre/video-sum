import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChunkService } from '../chunks/chunk.service';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryConfigService } from './summary-config.service';
import { SummaryPromptBuilder } from './summary-prompt.builder';
import { SummaryTextService } from './summary-text.service';
import { LlmJsonParser } from './llm-json-parser.service';
import { SummaryQualityChecker } from './summary-quality-checker.service';
import { LlmInvoker } from './llm-invoker.service';
import { ChunkSelector } from './chunk-selector.service';
import { ConcurrencySemaphore } from './concurrency-semaphore';
import { getTrimmedEnv } from '../config/env';
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
  private readonly logger = new Logger(SummaryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
    private readonly configService: SummaryConfigService,
    private readonly promptBuilder: SummaryPromptBuilder,
    private readonly text: SummaryTextService,
    private readonly jsonParser: LlmJsonParser,
    private readonly qualityChecker: SummaryQualityChecker,
    private readonly llmInvoker: LlmInvoker,
    private readonly chunkSelector: ChunkSelector,
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
    const draft = await this.buildAiSummaryDraft(sourceChunks);
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

  private async buildAiSummaryDraft(
    chunks: SourceChunk[],
  ): Promise<SummaryDraft> {
    const groqApiKey = getTrimmedEnv('GROQ_API_KEY');
    const config = this.configService.getConfig();

    if (!groqApiKey) {
      this.logger.error('GROQ_API_KEY is not configured');
      throw new InternalServerErrorException('GROQ_API_KEY is not configured');
    }

    const cleanChunks = this.chunkSelector.cleanChunks(chunks);
    if (cleanChunks.length === 0) {
      throw new NotFoundException('No transcript content found for summary');
    }

    const sourceText = cleanChunks.map((chunk) => chunk.content).join(' ');
    const sourceWordCount = this.text.countWords(sourceText);

    const selectedChunks = this.chunkSelector.selectSummaryChunks(
      cleanChunks,
      config,
    );
    const shouldUseDirect =
      config.mode === 'direct' ||
      (config.mode === 'auto' &&
        selectedChunks.length <= config.directMaxChunks);

    this.logger.log(
      [
        `Summary plan: mode=${config.mode}`,
        `selectedChunks=${selectedChunks.length}`,
        `directMaxChunks=${config.directMaxChunks}`,
        `mapModel=${config.mapModel}`,
        `reduceModel=${config.reduceModel}`,
        `route=${shouldUseDirect ? 'direct' : 'mapreduce'}`,
      ].join(', '),
    );

    let result: SummaryJson & { modelUsed: string };

    if (shouldUseDirect) {
      result = await this.buildDirectAiSummaryDraft(
        selectedChunks,
        config,
        groqApiKey,
      );
    } else {
      result = await this.buildMapReduceSummaryDraft(
        selectedChunks,
        config,
        groqApiKey,
      );
    }

    return {
      ...result,
      sourceChunkCount: cleanChunks.length,
      sourceWordCount,
    };
  }

  private async buildDirectAiSummaryDraft(
    chunks: SourceChunk[],
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<SummaryJson & { modelUsed: string }> {
    this.logger.log(
      `Summary direct phase using model=${config.reduceModel}, maxTokens=${config.reduceMaxTokens}, chunks=${chunks.length}`,
    );
    const llm = this.llmInvoker.createLlm(
      config.reduceModel,
      groqApiKey,
      config.reduceMaxTokens,
      config,
    );
    const response = await this.llmInvoker.invokeLlmWithRetry(
      () =>
        this.llmInvoker.invokeJsonLlm(
          llm,
          this.promptBuilder.buildDirectSummaryPrompt(
            chunks,
            config.chunkWordLimit,
          ),
        ),
      config,
    );
    const parsed = this.jsonParser.parseSummaryJson(
      this.jsonParser.extractMessageText(response.content),
    );

    const result = {
      ...parsed,
      modelUsed: `groq:${config.reduceModel}:math-summary-direct-v2`,
    };

    const tempDraft: SummaryDraft = {
      ...result,
      sourceChunkCount: chunks.length,
      sourceWordCount: 0,
    };

    if (this.qualityChecker.isLowQualitySummary(tempDraft)) {
      this.logger.error('AI direct summary failed quality check (low information).');
      throw new UnprocessableEntityException('AI summary is of too low quality.');
    }

    return result;
  }

  private async buildMapReduceSummaryDraft(
    chunks: SourceChunk[],
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<SummaryJson & { modelUsed: string }> {
    this.logger.log(
      `Summary mapreduce phase start: mapModel=${config.mapModel}, reduceModel=${config.reduceModel}, chunks=${chunks.length}`,
    );
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
    const result = {
      ...reduced,
      modelUsed: `groq:${config.reduceModel}:math-summary-mapreduce-v1`,
    };

    const tempDraft: SummaryDraft = {
      ...result,
      sourceChunkCount: chunks.length,
      sourceWordCount: 0,
    };

    if (this.qualityChecker.isLowQualitySummary(tempDraft)) {
      this.logger.error('AI mapreduce summary failed quality check (low information).');
      throw new UnprocessableEntityException('AI summary is of too low quality.');
    }

    return result;
  }

  private async buildMapSummaries(
    chunks: SourceChunk[],
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<MapSummary[]> {
    const groups = this.chunkSelector.groupChunks(chunks, config.mapGroupSize);
    this.logger.log(
      `Summary map phase using model=${config.mapModel}, groups=${groups.length}, groupSize=${config.mapGroupSize}, maxTokens=${config.mapMaxTokens}`,
    );
    const llm = this.llmInvoker.createLlm(
      config.mapModel,
      groqApiKey,
      config.mapMaxTokens,
      config,
    );

    const semaphore = new ConcurrencySemaphore(3);

    const promises = groups.map((group, index) =>
      semaphore.run(async () => {
        const response = await this.llmInvoker.invokeLlmWithRetry(
          () =>
            this.llmInvoker.invokeJsonLlm(
              llm,
              this.promptBuilder.buildMapSummaryPrompt(
                index,
                group,
                config.chunkWordLimit,
              ),
            ),
          config,
        );
        return this.jsonParser.parseMapSummary(
          this.jsonParser.extractMessageText(response.content),
          {
            groupIndex: index,
            chunks: group,
          },
        );
      }),
    );

    return Promise.all(promises);
  }

  private async collapseMapSummariesIfNeeded(
    mapSummaries: MapSummary[],
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<Array<MapSummary | CollapsedSummary>> {
    if (mapSummaries.length <= config.collapseMaxGroups) {
      return mapSummaries;
    }

    const collapseGroupSize = Math.ceil(
      mapSummaries.length / config.collapseMaxGroups,
    );
    const groups = this.chunkSelector.groupItems(
      mapSummaries,
      collapseGroupSize,
    );
    this.logger.log(
      `Summary collapse phase using model=${config.mapModel}, batches=${groups.length}, collapseMaxGroups=${config.collapseMaxGroups}, collapseGroupSize=${collapseGroupSize}, maxTokens=${config.collapseMaxTokens}`,
    );
    const llm = this.llmInvoker.createLlm(
      config.mapModel,
      groqApiKey,
      config.collapseMaxTokens,
      config,
    );

    const semaphore = new ConcurrencySemaphore(3);

    const promises = groups.map((group, index) =>
      semaphore.run(async () => {
        const response = await this.llmInvoker.invokeLlmWithRetry(
          () =>
            this.llmInvoker.invokeJsonLlm(
              llm,
              this.promptBuilder.buildCollapseSummaryPrompt(index, group),
            ),
          config,
        );
        return this.jsonParser.parseCollapsedSummary(
          this.jsonParser.extractMessageText(response.content),
          group,
        );
      }),
    );

    return Promise.all(promises);
  }

  private async reduceSummaries(
    summaries: Array<MapSummary | CollapsedSummary>,
    config: SummaryConfig,
    groqApiKey: string,
  ): Promise<SummaryJson> {
    this.logger.log(
      `Summary reduce phase using model=${config.reduceModel}, items=${summaries.length}, maxTokens=${config.reduceMaxTokens}`,
    );
    const llm = this.llmInvoker.createLlm(
      config.reduceModel,
      groqApiKey,
      config.reduceMaxTokens,
      config,
    );
    const response = await this.llmInvoker.invokeLlmWithRetry(
      () =>
        this.llmInvoker.invokeJsonLlm(
          llm,
          this.promptBuilder.buildReduceSummaryPrompt(summaries),
        ),
      config,
    );

    return this.jsonParser.parseSummaryJson(
      this.jsonParser.extractMessageText(response.content),
    );
  }
}
