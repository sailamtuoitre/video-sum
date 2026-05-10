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
import { VectorStoreService } from '../vector-store/vector-store.service';
import { CreateChunkDto } from './dto/create-chunk.dto';
import { UpdateChunkDto } from './dto/update-chunk.dto';

type GeneratedChunk = {
  content: string;
  chunkIndex: number;
  tokenCount: number;
  startChar: number;
  endChar: number;
};

type SemanticChunkResult = {
  text?: string;
  token_length?: number;
};

type ChunkBuildStrategy = 'semantic' | 'fixed-word-fallback';

type ChunkBuildResult = {
  strategy: ChunkBuildStrategy;
  chunks: GeneratedChunk[];
};

type ChunksFromVideoResult = ChunkBuildResult & {
  videoId: string;
  transcriptId: string;
  source: string;
  wordCount: number | null;
};

type ChunkPreviewPayload = {
  text?: string;
  rawText?: string;
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

function isChunkPreviewPayload(value: unknown): value is ChunkPreviewPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('text' in value || 'rawText' in value)
  );
}

@Injectable()
export class ChunkService {
  private readonly logger = new Logger(ChunkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly vectorStoreService: VectorStoreService,
  ) {}

  async create(createChunkDto: CreateChunkDto) {
    try {
      return await this.prisma.chunk.create({
        data: createChunkDto,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAll(videoId?: string, transcriptId?: string) {
    return this.prisma.chunk.findMany({
      where: {
        ...(videoId ? { videoId } : {}),
        ...(transcriptId ? { transcriptId } : {}),
      },
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

  async update(id: string, updateChunkDto: UpdateChunkDto) {
    try {
      return await this.prisma.chunk.update({
        where: {
          id,
        },
        data: updateChunkDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
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

  normalizeChunkPreviewInput(input: unknown) {
    if (typeof input === 'string') {
      const normalized = input.trim();
      if (!normalized) {
        throw new BadRequestException(
          'Chunk preview input string must not be empty',
        );
      }

      return normalized;
    }

    if (input && typeof input === 'object') {
      const payload = input;
      const candidate =
        isChunkPreviewPayload(payload) && typeof payload.text === 'string'
          ? payload.text
          : isChunkPreviewPayload(payload) &&
              typeof payload.rawText === 'string'
            ? payload.rawText
            : null;

      if (candidate && candidate.trim()) {
        return candidate.trim();
      }
    }

    throw new BadRequestException(
      'Chunk preview expects a non-empty string, or an object with text/rawText',
    );
  }

  async previewTranscriptChunks(rawText: string): Promise<ChunkBuildResult> {
    if (!rawText.trim()) {
      return {
        strategy: 'fixed-word-fallback',
        chunks: [],
      };
    }

    try {
      const semanticChunks = await this.buildSemanticChunks(rawText);
      if (semanticChunks.length > 0) {
        return {
          strategy: 'semantic',
          chunks: semanticChunks,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown chunking error';
      this.logger.warn(
        `Semantic chunking failed, falling back to fixed-size chunking: ${message}`,
      );
    }

    return {
      strategy: 'fixed-word-fallback',
      chunks: this.buildFixedWordChunks(rawText),
    };
  }

  async previewChunksFromVideo(
    videoId: string,
  ): Promise<ChunksFromVideoResult> {
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

    return {
      ...result,
      videoId,
      transcriptId: transcript.id,
      source: transcript.source,
      wordCount: transcript.wordCount ?? null,
    };
  }

  async buildTranscriptChunks(rawText: string): Promise<GeneratedChunk[]> {
    const result = await this.previewTranscriptChunks(rawText);
    return result.chunks;
  }

  async ensureTranscriptChunks(
    videoId: string,
    transcriptId: string,
    rawText: string,
  ) {
    let storedChunks = await this.prisma.chunk.findMany({
      where: {
        transcriptId,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });

    if (storedChunks.length > 0) {
      await this.vectorStoreService.indexChunks(
        storedChunks.map((chunk) => ({
          id: chunk.id,
          videoId: chunk.videoId,
          transcriptId: chunk.transcriptId,
          content: chunk.content,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          startChar: chunk.startChar,
          endChar: chunk.endChar,
        })),
      );

      return storedChunks;
    }

    const generatedChunks = await this.buildTranscriptChunks(rawText);

    if (generatedChunks.length === 0) {
      return [];
    }

    await this.prisma.chunk.createMany({
      data: generatedChunks.map((chunk) => ({
        videoId,
        transcriptId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
      })),
    });

    storedChunks = await this.prisma.chunk.findMany({
      where: {
        transcriptId,
      },
      orderBy: {
        chunkIndex: 'asc',
      },
    });

    await this.vectorStoreService.indexChunks(
      storedChunks.map((chunk) => ({
        id: chunk.id,
        videoId: chunk.videoId,
        transcriptId: chunk.transcriptId,
        content: chunk.content,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        startChar: chunk.startChar,
        endChar: chunk.endChar,
      })),
    );

    return storedChunks;
  }

  private async buildSemanticChunks(
    rawText: string,
  ): Promise<GeneratedChunk[]> {
    const semanticChunking =
      (await import('semantic-chunking')) as SemanticChunkingModule;
    const semanticSourceText =
      this.prepareTranscriptForSemanticChunking(rawText);
    const results = this.normalizeSemanticChunkResults(
      await semanticChunking.chunkit(
        [
          {
            document_name: 'video-transcript',
            document_text: semanticSourceText,
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

    return this.mapSemanticResultsToGeneratedChunks(
      semanticSourceText,
      results,
    );
  }

  private prepareTranscriptForSemanticChunking(rawText: string) {
    const normalized = rawText.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return normalized;
    }

    if (/[.!?…]\s/.test(normalized) || /[.!?…]$/.test(normalized)) {
      return normalized;
    }

    const words = normalized.split(/\s+/).filter(Boolean);
    if (words.length <= 24) {
      return `${normalized}.`;
    }

    const sentences: string[] = [];
    for (let index = 0; index < words.length; index += 24) {
      const sentence = words.slice(index, index + 24).join(' ');
      sentences.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
    }

    return sentences.join(' ');
  }

  private mapSemanticResultsToGeneratedChunks(
    rawText: string,
    results: SemanticChunkResult[],
  ): GeneratedChunk[] {
    const chunks: GeneratedChunk[] = [];
    let cursor = 0;

    for (const result of results) {
      const content = result.text?.trim();
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

  private normalizeSemanticChunkResults(
    results: unknown,
  ): SemanticChunkResult[] {
    const chunkResults: unknown[] = Array.isArray(results) ? results : [];
    const normalized: SemanticChunkResult[] = [];

    for (const result of chunkResults) {
      if (typeof result !== 'object' || result === null) {
        continue;
      }

      const record = result as Record<string, unknown>;
      const text = typeof record.text === 'string' ? record.text : undefined;
      const tokenLength =
        typeof record.token_length === 'number'
          ? record.token_length
          : undefined;

      if (text === undefined && tokenLength === undefined) {
        continue;
      }

      normalized.push({
        text,
        token_length: tokenLength,
      });
    }

    return normalized;
  }

  private findChunkStart(rawText: string, content: string, cursor: number) {
    const exactMatch = rawText.indexOf(content, cursor);
    if (exactMatch !== -1) {
      return exactMatch;
    }

    return rawText.indexOf(content);
  }

  private buildFixedWordChunks(rawText: string): GeneratedChunk[] {
    const maxWords = 180;
    const words = rawText.split(/\s+/).filter(Boolean);
    const chunks: GeneratedChunk[] = [];
    let cursor = 0;

    for (let index = 0; index < words.length; index += maxWords) {
      const content = words.slice(index, index + maxWords).join(' ');
      const startChar = rawText.indexOf(content.split(' ')[0], cursor);
      const endChar = startChar + content.length;
      cursor = endChar;

      chunks.push({
        content,
        chunkIndex: chunks.length,
        tokenCount: this.countWords(content),
        startChar: Math.max(startChar, 0),
        endChar,
      });
    }

    return chunks;
  }

  private countWords(text: string) {
    return text.split(/\s+/).filter(Boolean).length;
  }

  private getModelCacheDir() {
    return this.configService.get<string>(
      'SEMANTIC_CHUNKING_MODEL_CACHE_DIR',
      join(process.cwd(), 'models', 'semantic-chunking'),
    );
  }

  private getNumberConfig(key: string, fallback: number) {
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
