import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

type EmbeddedSentence = {
  document_name: string;
  embedding?: number[];
};

type SemanticChunkingModule = {
  sentenceit: (
    documents: {
      document_name: string;
      document_text: string;
    }[],
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
};

export type IndexedChunkInput = {
  id: string;
  videoId: string;
  transcriptId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number | null;
  startChar: number | null;
  endChar: number | null;
};

export type IndexedChatMemoryInput = {
  id: string;
  sessionId: string;
  projectId: string | null;
  videoId: string | null;
  turnIndex: number;
  userMessageId: string;
  assistantMessageId: string;
  question: string;
  answer: string;
  content: string;
};

export type VectorSearchResult = {
  citationId: string;
  chunkId: string;
  videoId: string;
  transcriptId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  startChar: number | null;
  endChar: number | null;
  score: number;
  distance: number;
  cosineScore: number;
  keywordScore: number;
};

export type VectorSearchScope = {
  projectId?: string | null;
  videoId?: string | null;
};

export type ChatMemorySearchScope = {
  sessionId?: string | null;
  projectId?: string | null;
  videoId?: string | null;
};

type StoredChunkEmbedding = {
  chunk_id: string;
  video_id: string;
  transcript_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  start_char: number | null;
  end_char: number | null;
  distance?: number;
};

type StoredChatMemoryEmbedding = {
  memory_id: string;
  session_id: string;
  project_id: string | null;
  video_id: string | null;
  turn_index: number;
  user_message_id: string;
  assistant_message_id: string;
  question: string;
  answer: string;
  content: string;
  distance?: number;
};

@Injectable()
export class VectorStoreService {
  private readonly logger = new Logger(VectorStoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async indexChunks(chunks: IndexedChunkInput[]) {
    if (chunks.length === 0) {
      return;
    }

    const embeddings = await this.embedTexts(
      chunks.map((chunk) => chunk.content),
      'search_document',
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const embedding = embeddings[index];

      if (embedding.length === 0) {
        this.logger.warn(
          `Skipping vector index for chunk "${chunk.id}::uuid" because embedding is empty`,
        );
        continue;
      }

      await this.prisma.$executeRaw`
        INSERT INTO chunk_embeddings (
          id,
          chunk_id,
          video_id,
          transcript_id,
          chunk_index,
          content,
          token_count,
          start_char,
          end_char,
          embedding
        )
        VALUES (
          gen_random_uuid(),
          ${chunk.id}::uuid,
          ${chunk.videoId}::uuid,
          ${chunk.transcriptId}::uuid,
          ${chunk.chunkIndex},
          ${chunk.content},
          ${chunk.tokenCount},
          ${chunk.startChar},
          ${chunk.endChar},
          ${this.formatVectorLiteral(embedding)}::vector
        )
        ON CONFLICT (chunk_id) DO UPDATE SET
          video_id = EXCLUDED.video_id,
          transcript_id = EXCLUDED.transcript_id,
          chunk_index = EXCLUDED.chunk_index,
          content = EXCLUDED.content,
          token_count = EXCLUDED.token_count,
          start_char = EXCLUDED.start_char,
          end_char = EXCLUDED.end_char,
          embedding = EXCLUDED.embedding;
      `;
    }
  }

  async indexChatMemory(entries: IndexedChatMemoryInput[]) {
    if (entries.length === 0) {
      return;
    }

    const embeddings = await this.embedTexts(
      entries.map((entry) => entry.content),
      'chat_memory',
    );

    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const embedding = embeddings[index];

      if (embedding.length === 0) {
        this.logger.warn(
          `Skipping chat memory vector index for turn "${entry.id}" because embedding is empty`,
        );
        continue;
      }

      await this.prisma.$executeRaw`
        INSERT INTO chat_memory_embeddings (
          id,
          session_id,
          project_id,
          video_id,
          turn_index,
          user_message_id,
          assistant_message_id,
          question,
          answer,
          content,
          embedding
        )
        VALUES (
          gen_random_uuid(),
          ${entry.sessionId}::uuid,
          ${entry.projectId}::uuid,
          ${entry.videoId}::uuid,
          ${entry.turnIndex},
          ${entry.userMessageId}::uuid,
          ${entry.assistantMessageId}::uuid,
          ${entry.question},
          ${entry.answer},
          ${entry.content},
          ${this.formatVectorLiteral(embedding)}::vector
        )
        ON CONFLICT (assistant_message_id) DO UPDATE SET
          session_id = EXCLUDED.session_id,
          project_id = EXCLUDED.project_id,
          video_id = EXCLUDED.video_id,
          turn_index = EXCLUDED.turn_index,
          user_message_id = EXCLUDED.user_message_id,
          question = EXCLUDED.question,
          answer = EXCLUDED.answer,
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding;
      `;
    }
  }

  async searchRelevantChunks(
    question: string,
    limit = 5,
    scope: VectorSearchScope = {},
  ) {
    const [queryEmbedding] = await this.embedTexts([question], 'search_query');
    if (queryEmbedding.length === 0) {
      return [];
    }

    const conditions: Prisma.Sql[] = [];
    if (scope.projectId) {
      conditions.push(Prisma.sql`v.project_id = ${scope.projectId}`);
    }
    if (scope.videoId) {
      conditions.push(Prisma.sql`ce.video_id = ${scope.videoId}`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const vectorLiteral = this.formatVectorLiteral(queryEmbedding);
    const rows = await this.prisma.$queryRaw<StoredChunkEmbedding[]>(Prisma.sql`
      SELECT
        ce.chunk_id,
        ce.video_id,
        ce.transcript_id,
        ce.chunk_index,
        ce.content,
        ce.token_count,
        ce.start_char,
        ce.end_char,
        ce.embedding <=> ${vectorLiteral}::vector AS distance
      FROM chunk_embeddings ce
      INNER JOIN videos v ON v.id = ce.video_id
      ${whereClause}
      ORDER BY ce.embedding <=> ${vectorLiteral}::vector ASC
      LIMIT ${limit}
    `);

    return rows.map((row, index) => ({
      citationId: `C${index + 1}`,
      chunkId: row.chunk_id,
      videoId: row.video_id,
      transcriptId: row.transcript_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count ?? 0,
      startChar: row.start_char,
      endChar: row.end_char,
      distance: Number(row.distance ?? 0),
      score: Number.isFinite(Number(row.distance))
        ? 1 - Number(row.distance ?? 0)
        : 0,
      cosineScore: Number.isFinite(Number(row.distance))
        ? 1 - Number(row.distance ?? 0)
        : 0,
      keywordScore: 0,
    }));
  }

  async searchRelevantChatMemory(
    question: string,
    limit = 5,
    scope: ChatMemorySearchScope = {},
  ) {
    const [queryEmbedding] = await this.embedTexts([question], 'search_query');
    if (queryEmbedding.length === 0) {
      return [];
    }

    const conditions: Prisma.Sql[] = [];
    if (scope.sessionId) {
      conditions.push(Prisma.sql`cm.session_id = ${scope.sessionId}`);
    }
    if (scope.projectId) {
      conditions.push(Prisma.sql`cm.project_id = ${scope.projectId}`);
    }
    if (scope.videoId) {
      conditions.push(Prisma.sql`cm.video_id = ${scope.videoId}`);
    }

    const whereClause =
      conditions.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
        : Prisma.empty;

    const vectorLiteral = this.formatVectorLiteral(queryEmbedding);
    const rows = await this.prisma.$queryRaw<
      StoredChatMemoryEmbedding[]
    >(Prisma.sql`
      SELECT
        cm.id AS memory_id,
        cm.session_id,
        cm.project_id,
        cm.video_id,
        cm.turn_index,
        cm.user_message_id,
        cm.assistant_message_id,
        cm.question,
        cm.answer,
        cm.content,
        cm.embedding <=> ${vectorLiteral}::vector AS distance
      FROM chat_memory_embeddings cm
      ${whereClause}
      ORDER BY cm.embedding <=> ${vectorLiteral}::vector ASC,
        cm.turn_index DESC
      LIMIT ${limit}
    `);

    return rows.map((row, index) => ({
      citationId: `M${index + 1}`,
      memoryId: row.memory_id,
      sessionId: row.session_id,
      projectId: row.project_id,
      videoId: row.video_id,
      turnIndex: row.turn_index,
      userMessageId: row.user_message_id,
      assistantMessageId: row.assistant_message_id,
      question: row.question,
      answer: row.answer,
      content: row.content,
      distance: Number(row.distance ?? 0),
      score: Number.isFinite(Number(row.distance))
        ? 1 - Number(row.distance ?? 0)
        : 0,
      cosineScore: Number.isFinite(Number(row.distance))
        ? 1 - Number(row.distance ?? 0)
        : 0,
      keywordScore: 0,
    }));
  }

  async embedTexts(texts: string[], prefix: string) {
    const normalizedTexts = texts.map((text) => text.trim()).filter(Boolean);
    if (normalizedTexts.length === 0) {
      return [] as number[][];
    }

    const semanticChunking =
      (await import('semantic-chunking')) as unknown as SemanticChunkingModule;

    const documents = normalizedTexts.map((text, index) => ({
      document_name: `${prefix}-${index}`,
      document_text: text,
    }));

    const results = (await semanticChunking.sentenceit(documents, {
      returnEmbedding: true,
      chunkPrefix: prefix,
      onnxEmbeddingModel: this.getEmbeddingModel(),
      dtype: this.getEmbeddingDtype(),
      device: this.getEmbeddingDevice(),
      localModelPath: this.getEmbeddingModelCacheDir(),
      modelCacheDir: this.getEmbeddingModelCacheDir(),
    })) as EmbeddedSentence[];

    const groupedEmbeddings = new Map<string, number[][]>();
    for (const result of results) {
      const emb = result.embedding;
      if (!emb || typeof emb !== 'object' || !('length' in emb)) {
        continue;
      }

      const key = result.document_name;
      const current = groupedEmbeddings.get(key) ?? [];
      current.push(Array.from(emb));
      groupedEmbeddings.set(key, current);
    }

    return normalizedTexts.map((_, index) => {
      const key = `${prefix}-${index}`;
      const vectors = groupedEmbeddings.get(key) ?? [];
      return this.averageVectors(vectors);
    });
  }

  private averageVectors(vectors: number[][]) {
    if (vectors.length === 0) {
      return [];
    }

    const dimension = vectors[0]?.length ?? 0;
    if (dimension === 0) {
      return [];
    }

    const totals = Array.from({ length: dimension }, () => 0);
    let count = 0;

    for (const vector of vectors) {
      if (vector.length !== dimension) {
        continue;
      }

      for (let index = 0; index < dimension; index += 1) {
        totals[index] += vector[index];
      }

      count += 1;
    }

    if (count === 0) {
      return [];
    }

    return this.normalizeVector(totals.map((value) => value / count));
  }

  private normalizeVector(vector: number[]) {
    const magnitude = Math.sqrt(
      vector.reduce((sum, value) => sum + value * value, 0),
    );

    if (!Number.isFinite(magnitude) || magnitude === 0) {
      return vector;
    }

    return vector.map((value) => value / magnitude);
  }

  private formatVectorLiteral(vector: number[]) {
    return `[${vector.map((value) => Number(value).toFixed(8)).join(',')}]`;
  }

  private getEmbeddingModel() {
    return this.configService.get<string>(
      'SEMANTIC_CHUNKING_MODEL',
      'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
    );
  }

  private getEmbeddingDtype() {
    return this.configService.get<string>('SEMANTIC_CHUNKING_DTYPE', 'q8');
  }

  private getEmbeddingDevice() {
    return this.configService.get<string>('SEMANTIC_CHUNKING_DEVICE', 'cpu');
  }

  private getEmbeddingModelCacheDir() {
    return this.configService.get<string>(
      'SEMANTIC_CHUNKING_MODEL_CACHE_DIR',
      join(process.cwd(), 'models', 'semantic-chunking'),
    );
  }
}
