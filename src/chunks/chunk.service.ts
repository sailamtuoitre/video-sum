import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

type GeneratedChunk = {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  startChar: number;
  endChar: number;
};

type ChunkBuildStrategy = 'semantic' | 'fixed-word-fallback';

type ChunkBuildResult = {
  strategy: ChunkBuildStrategy;
  chunks: GeneratedChunk[];
};

type ChunksFromVideoResult = {
  videoId: string;
  transcriptId: string;
  strategy: ChunkBuildStrategy;
  count: number;
  chunks: Awaited<ReturnType<PrismaService['chunk']['findMany']>>;
};

type PreviewPayload = {
  text?: string;
  rawText?: string;
};

type SemanticChunkResult = {
  text?: string;
  token_length?: number;
};

type SemanticChunkingModule = {
  chunkit: (
    documents: {
      document_name: string;
      document_text: string;
    }[],
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

@Injectable()
export class ChunkService {
  private readonly logger = new Logger(ChunkService.name);
  private readonly fixedChunkMaxWords = 180;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  findAll(videoId?: string, transcriptId?: string) {
    return this.prisma.chunk.findMany({
      where:
        videoId || transcriptId
          ? {
              ...(videoId ? { videoId } : {}),
              ...(transcriptId ? { transcriptId } : {}),
            }
          : undefined,
      orderBy: [
        {
          videoId: 'asc',
        },
        {
          chunkIndex: 'asc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const chunk = await this.prisma.chunk.findUnique({
      where: {
        id,
      },
    });

    if (!chunk) {
      throw new NotFoundException(`Chunk with id "${id}" not found`);
    }

    return chunk;
  }

  async remove(id: string) {
    try {
      return await this.prisma.chunk.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  normalizePreviewInput(input: unknown): string {
    if (typeof input === 'string') {
      return this.assertNonEmptyText(input);
    }

    if (this.isPreviewPayload(input)) {
      return this.assertNonEmptyText(input.text ?? input.rawText ?? '');
    }

    throw new BadRequestException(
      'Chunk preview expects a non-empty string, or an object with text/rawText',
    );
  }

  async previewTranscriptChunks(rawText: string): Promise<ChunkBuildResult> {
    const normalizedText = rawText.replace(/\s+/g, ' ').trim();

    if (!normalizedText) {
      return {
        strategy: 'fixed-word-fallback',
        chunks: [],
      };
    }

    try {
      const semanticChunks = await this.buildSemanticChunks(normalizedText);

      if (semanticChunks.length > 0) {
        return {
          strategy: 'semantic',
          chunks: semanticChunks,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown semantic error';
      this.logger.warn(
        `Semantic chunking failed. Falling back to fixed chunks: ${message}`,
      );
    }

    return {
      strategy: 'fixed-word-fallback',
      chunks: this.buildFixedWordChunks(normalizedText),
    };
  }

  async createFromVideo(videoId: string): Promise<ChunksFromVideoResult> {
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

    const result = await this.previewTranscriptChunks(transcript.rawText);
    const chunks = await this.replaceTranscriptChunks(
      videoId,
      transcript.id,
      result.chunks,
    );

    return {
      videoId,
      transcriptId: transcript.id,
      strategy: result.strategy,
      count: chunks.length,
      chunks,
    };
  }

  async ensureTranscriptChunks(
    videoId: string,
    transcriptId: string,
    rawText: string,
  ) {
    const existing = await this.prisma.chunk.findMany({
      where: {
        transcriptId,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });

    if (existing.length > 0) {
      return existing;
    }

    const result = await this.previewTranscriptChunks(rawText);
    return this.replaceTranscriptChunks(videoId, transcriptId, result.chunks);
  }

  async buildTranscriptChunks(rawText: string): Promise<GeneratedChunk[]> {
    const result = await this.previewTranscriptChunks(rawText);
    return result.chunks;
  }

  private async replaceTranscriptChunks(
    videoId: string,
    transcriptId: string,
    chunks: GeneratedChunk[],
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.chunk.deleteMany({
        where: {
          transcriptId,
        },
      });

      if (chunks.length > 0) {
        await tx.chunk.createMany({
          data: chunks.map((chunk) => ({
            videoId,
            transcriptId,
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
          })),
        });
      }

      return tx.chunk.findMany({
        where: {
          transcriptId,
        },
        orderBy: {
          chunkIndex: 'asc',
        },
      });
    });
  }

  private async buildSemanticChunks(
    rawText: string,
  ): Promise<GeneratedChunk[]> {
    const semanticChunking =
      (await import('semantic-chunking')) as SemanticChunkingModule;
    const preparedText = this.prepareTranscriptForSemanticChunking(rawText);
    const results = this.normalizeSemanticResults(
      await semanticChunking.chunkit(
        [
          {
            document_name: 'video-transcript',
            document_text: preparedText,
          },
        ],
        {
          onnxEmbeddingModel: this.configService.get<string>(
            'SEMANTIC_CHUNKING_MODEL',
            'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
          ),
          dtype: this.configService.get<string>(
            'SEMANTIC_CHUNKING_DTYPE',
            'q8',
          ),
          device: this.configService.get<string>(
            'SEMANTIC_CHUNKING_DEVICE',
            'cpu',
          ),
          modelCacheDir: this.getModelCacheDir(),
          localModelPath: this.getModelCacheDir(),
          maxTokenSize: this.getNumberConfig(
            'SEMANTIC_CHUNKING_MAX_TOKENS',
            220,
          ),
          similarityThreshold: this.getNumberConfig(
            'SEMANTIC_CHUNKING_SIMILARITY_THRESHOLD',
            0.45,
          ),
          dynamicThresholdLowerBound: this.getNumberConfig(
            'SEMANTIC_CHUNKING_DYNAMIC_LOWER',
            0.35,
          ),
          dynamicThresholdUpperBound: this.getNumberConfig(
            'SEMANTIC_CHUNKING_DYNAMIC_UPPER',
            0.75,
          ),
          numSimilaritySentencesLookahead: this.getNumberConfig(
            'SEMANTIC_CHUNKING_LOOKAHEAD',
            3,
          ),
          combineChunks: true,
          combineChunksSimilarityThreshold: this.getNumberConfig(
            'SEMANTIC_CHUNKING_COMBINE_THRESHOLD',
            0.5,
          ),
          returnTokenLength: true,
        },
      ),
    );

    return this.mapSemanticResultsToGeneratedChunks(preparedText, results);
  }

  private prepareTranscriptForSemanticChunking(rawText: string): string {
    const normalized = rawText.replace(/\s+/g, ' ').trim();

    if (!normalized) {
      return normalized;
    }

    if (/[.!?…]\s/.test(normalized) || /[.!?…]$/.test(normalized)) {
      return normalized;
    }

    const words = normalized.split(/\s+/).filter(Boolean);
    const sentences: string[] = [];

    for (let index = 0; index < words.length; index += 24) {
      const sentence = words.slice(index, index + 24).join(' ');
      sentences.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
    }

    return sentences.join(' ');
  }

  private normalizeSemanticResults(results: unknown): SemanticChunkResult[] {
    if (!Array.isArray(results)) {
      return [];
    }

    const normalized: SemanticChunkResult[] = [];

    for (const result of results) {
      if (typeof result !== 'object' || result === null) {
        continue;
      }

      const record = result as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text : undefined;
      const tokenLength =
        typeof record.token_length === 'number'
          ? record.token_length
          : undefined;

      if (!text) {
        continue;
      }

      normalized.push({
        text,
        token_length: tokenLength,
      });
    }

    return normalized;
  }

  private mapSemanticResultsToGeneratedChunks(
    rawText: string,
    results: SemanticChunkResult[],
  ): GeneratedChunk[] {
    const chunks: GeneratedChunk[] = [];
    let cursor = 0;

    for (const result of results) {
      const content = result.text?.replace(/\s+/g, ' ').trim();

      if (!content) {
        continue;
      }

      const startChar = this.findChunkStart(rawText, content, cursor);
      const safeStartChar = Math.max(startChar, 0);
      const endChar = safeStartChar + content.length;
      cursor = endChar;

      chunks.push({
        content,
        chunkIndex: chunks.length,
        tokenCount: result.token_length ?? this.countWords(content),
        startChar: safeStartChar,
        endChar,
      });
    }

    return chunks;
  }

  private buildFixedWordChunks(rawText: string): GeneratedChunk[] {
    const words = rawText.split(/\s+/).filter(Boolean);
    const chunks: GeneratedChunk[] = [];
    let cursor = 0;

    for (
      let index = 0;
      index < words.length;
      index += this.fixedChunkMaxWords
    ) {
      const content = words
        .slice(index, index + this.fixedChunkMaxWords)
        .join(' ');
      const startChar = this.findChunkStart(rawText, content, cursor);
      const safeStartChar = Math.max(startChar, 0);
      const endChar = safeStartChar + content.length;
      cursor = endChar;

      chunks.push({
        content,
        chunkIndex: chunks.length,
        tokenCount: this.countWords(content),
        startChar: safeStartChar,
        endChar,
      });
    }

    return chunks;
  }

  private findChunkStart(rawText: string, content: string, cursor: number) {
    const exactMatch = rawText.indexOf(content, cursor);

    if (exactMatch !== -1) {
      return exactMatch;
    }

    const firstWords = content.split(/\s+/).slice(0, 8).join(' ');
    const partialMatch = rawText.indexOf(firstWords, cursor);

    if (partialMatch !== -1) {
      return partialMatch;
    }

    return rawText.indexOf(content);
  }

  private assertNonEmptyText(value: string): string {
    const text = value.trim();

    if (!text) {
      throw new BadRequestException('Chunk input must not be empty');
    }

    return text;
  }

  private isPreviewPayload(value: unknown): value is PreviewPayload {
    return (
      typeof value === 'object' &&
      value !== null &&
      ('text' in value || 'rawText' in value)
    );
  }

  private countWords(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }

  private getModelCacheDir(): string {
    return this.configService.get<string>(
      'SEMANTIC_CHUNKING_MODEL_CACHE_DIR',
      join(process.cwd(), 'models', 'semantic-chunking'),
    );
  }

  private getNumberConfig(key: string, fallback: number): number {
    const value = this.configService.get<string | number>(key);

    if (value === undefined || value === null || value === '') {
      return fallback;
    }

    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        throw new NotFoundException('Related video or transcript not found');
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Chunk with id "${id}" not found`);
      }
    }

    throw error;
  }
}
