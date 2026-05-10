# Backend Architecture
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  
**Framework:** NestJS + TypeScript  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Project Structure](#2-project-structure)
3. [Module Architecture](#3-module-architecture)
4. [Service Layer Design](#4-service-layer-design)
5. [Background Processing (Async)](#5-background-processing-async)
6. [LLM Abstraction Layer](#6-llm-abstraction-layer)
7. [Caching Strategy (In-Memory)](#7-caching-strategy-in-memory)
8. [Configuration & Environment](#8-configuration--environment)
9. [Error Handling](#9-error-handling)
10. [Database Setup (TypeORM)](#10-database-setup-typeorm)

---

## 1. Overview

The backend is a **NestJS REST API** running on port `4000`. It is responsible for:

- Accepting video processing requests
- Managing async background processing (fire-and-forget)
- Orchestrating the full AI pipeline (transcript → chunk → embed → generate)
- Serving all data to the frontend via REST endpoints

### Key Design Principles

- **Separation of concerns** via NestJS modules
- **Single responsibility** per service
- **Provider injection** for LLM/embedding swappability
- **Async-first** for all AI operations (non-blocking)
- **Fail-safe** design with retries and error states

---

## 2. Project Structure

```
backend/
├── src/
│   ├── main.ts                            ← Bootstrap + Swagger setup
│   ├── app.module.ts                      ← Root module
│   │
│   ├── modules/
│   │   │
│   │   ├── video/
│   │   │   ├── video.module.ts
│   │   │   ├── video.controller.ts        ← POST /videos, GET /videos/:id
│   │   │   ├── video.service.ts           ← CRUD + status management
│   │   │   ├── video.entity.ts            ← TypeORM entity
│   │   │   └── dto/
│   │   │       ├── create-video.dto.ts
│   │   │       └── video-response.dto.ts
│   │   │
│   │   ├── transcript/
│   │   │   ├── transcript.module.ts
│   │   │   ├── transcript.service.ts      ← Orchestrates extraction
│   │   │   ├── youtube-caption.service.ts ← YouTube caption API
│   │   │   ├── whisper.service.ts         ← Whisper fallback STT
│   │   │   └── transcript.entity.ts
│   │   │
│   │   ├── rag/
│   │   │   ├── rag.module.ts
│   │   │   ├── rag.service.ts             ← Full RAG orchestrator
│   │   │   ├── chunking.service.ts        ← Text splitting
│   │   │   ├── embedding.service.ts       ← Embedding API calls
│   │   │   ├── vector-store.service.ts    ← Qdrant operations
│   │   │   └── chunk.entity.ts
│   │   │
│   │   ├── summary/
│   │   │   ├── summary.module.ts
│   │   │   ├── summary.controller.ts      ← GET /videos/:id/summary
│   │   │   ├── summary.service.ts         ← LLM-based summary generation
│   │   │   └── summary.entity.ts
│   │   │
│   │   ├── chat/
│   │   │   ├── chat.module.ts
│   │   │   ├── chat.controller.ts         ← Session + message endpoints
│   │   │   ├── chat.service.ts            ← RAG query + LLM response
│   │   │   ├── session.entity.ts
│   │   │   └── message.entity.ts
│   │   │
│   │   ├── quiz/
│   │   │   ├── quiz.module.ts
│   │   │   ├── quiz.controller.ts
│   │   │   ├── quiz.service.ts            ← LLM-based quiz generation
│   │   │   ├── quiz.entity.ts
│   │   │   └── quiz-question.entity.ts
│   │   │
│   │   └── flashcard/
│   │       ├── flashcard.module.ts
│   │       ├── flashcard.controller.ts
│   │       ├── flashcard.service.ts       ← LLM-based flashcard generation
│   │       ├── flashcard-set.entity.ts
│   │       └── flashcard.entity.ts
│   │
│   ├── common/
│   │   ├── llm/
│   │   │   ├── llm.module.ts
│   │   │   ├── llm.service.ts             ← Unified LLM interface
│   │   │   └── llm.types.ts
│   │   ├── filters/
│   │   │   └── http-exception.filter.ts
│   │   ├── interceptors/
│   │   │   └── logging.interceptor.ts
│   │   └── decorators/
│   │
│   └── config/
│       └── configuration.ts              ← Typed config via @nestjs/config
│
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── nest-cli.json
```

---

## 3. Module Architecture

### 3.1 Module Dependency Map

```
AppModule
├── ConfigModule (global)
├── TypeOrmModule (global, DB connection)
├── CacheModule (global, in-memory)
│
├── VideoModule
│   ├── imports: [TranscriptModule, RAGModule, SummaryModule]
│   └── exports: [VideoService]
│
├── TranscriptModule
│   └── exports: [TranscriptService]
│
├── RAGModule
│   ├── imports: [LLMModule]
│   └── exports: [RAGService, VectorStoreService]
│
├── SummaryModule
│   ├── imports: [LLMModule, RAGModule]
│   └── exports: [SummaryService]
│
├── ChatModule
│   ├── imports: [RAGModule, LLMModule]
│   └── exports: []
│
├── QuizModule
│   ├── imports: [LLMModule]
│   └── exports: []
│
├── FlashcardModule
│   ├── imports: [LLMModule]
│   └── exports: []
│
└── LLMModule (global)
    └── exports: [LLMService, EmbeddingService]
```

---

## 4. Service Layer Design

### 4.1 `VideoService`

```ts
@Injectable()
export class VideoService {
  constructor(
    @InjectRepository(VideoEntity) private videoRepo: Repository<VideoEntity>,
    private transcriptService: TranscriptService,
    private ragService: RAGService,
    private summaryService: SummaryService,
  ) {}

  async create(url: string): Promise<VideoEntity> {
    // 1. Extract youtube_id from URL
    // 2. Check for existing video (deduplication)
    // 3. INSERT with status 'pending'
    // 4. Fire-and-forget background processing
    // 5. Return video record immediately (202 Accepted)
  }

  private async processVideoInBackground(videoId: string): Promise<void> {
    // Runs async without blocking HTTP response
    await this.videoRepo.update(videoId, { status: 'processing' });
    try {
      const transcript = await this.transcriptService.extract(videoId);
      await this.ragService.indexTranscript(transcript);
      await this.summaryService.generate(videoId, transcript);
      await this.videoRepo.update(videoId, { status: 'completed' });
    } catch (err) {
      await this.videoRepo.update(videoId, { status: 'failed', errorMessage: err.message });
    }
  }

  async findById(id: string): Promise<VideoEntity> { ... }
  async findAll(): Promise<VideoEntity[]> { ... }
  async updateStatus(id: string, status: VideoStatus, error?: string): Promise<void> { ... }
}
```

### 4.2 `TranscriptService`

```ts
@Injectable()
export class TranscriptService {
  async extract(videoId: string, youtubeId: string): Promise<TranscriptEntity> {
    // 1. Try YouTubeCaptionService.fetch(youtubeId)
    // 2. If captions unavailable → WhisperService.transcribe(youtubeUrl)
    // 3. Store raw_text + source in DB
    // 4. Return transcript entity
  }
}
```

### 4.3 `YouTubeCaptionService`

```ts
@Injectable()
export class YouTubeCaptionService {
  async fetch(youtubeId: string): Promise<string | null> {
    // Uses youtube-transcript npm package
    // Fetches available captions (prefer 'vi', fallback 'en')
    // Returns concatenated plain text
    // Returns null if captions disabled
  }
}
```

### 4.4 `ChunkingService`

```ts
@Injectable()
export class ChunkingService {
  private readonly CHUNK_SIZE = 500;   // tokens
  private readonly OVERLAP = 50;       // tokens

  chunk(text: string, transcriptId: string, videoId: string): ChunkEntity[] {
    // 1. Tokenize text (using tiktoken or char estimate)
    // 2. Split at sentence boundaries within token window
    // 3. Apply sliding window with overlap
    // 4. Return ChunkEntity[] with index, start_char, end_char
  }
}
```

### 4.5 `EmbeddingService`

```ts
@Injectable()
export class EmbeddingService {
  constructor(private config: ConfigService) {}

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Batches of 20 texts per API call
    // Returns float32[] per text
    // Supports: OpenAI text-embedding-3-small | HuggingFace multilingual-e5-base
  }

  async embedSingle(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }
}
```

### 4.6 `VectorStoreService`

```ts
@Injectable()
export class VectorStoreService {
  private qdrant: QdrantClient;

  async upsertChunks(chunks: ChunkEntity[], vectors: number[][]): Promise<void> {
    // Prepare points: { id, vector, payload: { video_id, content, ... } }
    // qdrant.upsert('video_chunks', { points })
  }

  async search(queryVector: number[], videoId: string, topK = 5): Promise<SearchResult[]> {
    // qdrant.search('video_chunks', {
    //   vector: queryVector,
    //   filter: { must: [{ key: 'video_id', match: { value: videoId } }] },
    //   limit: topK,
    //   with_payload: true
    // })
  }

  async deleteByVideoId(videoId: string): Promise<void> {
    // qdrant.delete('video_chunks', { filter: { ... } })
  }
}
```

### 4.7 `RAGService`

```ts
@Injectable()
export class RAGService {
  constructor(
    private chunkingService: ChunkingService,
    private embeddingService: EmbeddingService,
    private vectorStoreService: VectorStoreService,
    @InjectRepository(ChunkEntity) private chunkRepo: Repository<ChunkEntity>,
  ) {}

  async indexTranscript(transcript: TranscriptEntity): Promise<void> {
    const chunks = this.chunkingService.chunk(
      transcript.rawText, transcript.id, transcript.videoId
    );
    await this.chunkRepo.save(chunks);

    const vectors = await this.embeddingService.embedBatch(
      chunks.map(c => c.content)
    );
    await this.vectorStoreService.upsertChunks(chunks, vectors);

    // Update chunk.embedding_id references
  }

  async retrieve(query: string, videoId: string, topK = 5): Promise<RetrievedChunk[]> {
    const queryVector = await this.embeddingService.embedSingle(query);
    return this.vectorStoreService.search(queryVector, videoId, topK);
  }
}
```

### 4.8 `ChatService`

```ts
@Injectable()
export class ChatService {
  constructor(
    private ragService: RAGService,
    private llmService: LLMService,
    @InjectRepository(ChatMessageEntity) private msgRepo: Repository<ChatMessageEntity>,
    @InjectRepository(ChatSessionEntity) private sessionRepo: Repository<ChatSessionEntity>,
  ) {}

  async sendMessage(sessionId: string, userContent: string): Promise<ChatMessageEntity> {
    const session = await this.sessionRepo.findOneOrFail({ where: { id: sessionId } });

    // 1. Save user message
    await this.msgRepo.save({ sessionId, role: 'user', content: userContent });

    // 2. Retrieve relevant chunks
    const retrieved = await this.ragService.retrieve(userContent, session.videoId);

    // 3. Build history (last 6 messages)
    const history = await this.msgRepo.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: 6,
    });

    // 4. Build prompt
    const prompt = this.buildRAGPrompt(userContent, retrieved, history.reverse());

    // 5. LLM call
    const answer = await this.llmService.complete(prompt);

    // 6. Save assistant message
    const assistantMsg = await this.msgRepo.save({
      sessionId,
      role: 'assistant',
      content: answer.content,
      retrievedChunks: retrieved.map(r => r.chunkId),
      promptTokens: answer.usage.promptTokens,
      completionTokens: answer.usage.completionTokens,
    });

    return assistantMsg;
  }

  private buildRAGPrompt(query: string, chunks: RetrievedChunk[], history: ChatMessageEntity[]) {
    return {
      system: `Bạn là trợ lý học tập thông minh. 
Chỉ trả lời dựa trên [CONTEXT] được cung cấp. 
Nếu câu hỏi không có trong context, hãy trả lời: "Thông tin này không có trong video."
Không được bịa thêm thông tin ngoài context.`,
      context: chunks.map((c, i) => `[${i+1}] ${c.content}`).join('\n\n'),
      history: history.map(m => ({ role: m.role, content: m.content })),
      query,
    };
  }
}
```

---

## 5. Background Processing (Async)

### 5.1 Pattern: Fire-and-Forget

Thay vì dùng BullMQ (cần Redis, overkill cho local), toàn bộ pipeline xử lý video chạy dưới dạng **async background task** trong cùng Node.js process.

```ts
// video.service.ts
async create(url: string): Promise<VideoEntity> {
  const youtubeId = this.extractYoutubeId(url);

  // Deduplication check
  const existing = await this.videoRepo.findOne({ where: { youtubeId } });
  if (existing) throw new ConflictException({ message: 'Video already processed', existingId: existing.id });

  const video = await this.videoRepo.save({ url, youtubeId, status: 'pending' });

  // Fire-and-forget: không await, không block HTTP response
  this.processVideoInBackground(video.id).catch(err => {
    this.logger.error(`Background processing failed for ${video.id}`, err);
  });

  return video;  // trả về ngay → 202 Accepted
}

private async processVideoInBackground(videoId: string): Promise<void> {
  await this.videoRepo.update(videoId, { status: 'processing' });
  try {
    const transcript = await this.transcriptService.extract(videoId);
    await this.ragService.indexTranscript(transcript);
    await this.summaryService.generate(videoId, transcript);
    await this.videoRepo.update(videoId, { status: 'completed' });
  } catch (err) {
    await this.videoRepo.update(videoId, { status: 'failed', errorMessage: err.message });
  }
}
```

### 5.2 Progress Tracking

Không cần job progress của BullMQ — frontend poll `GET /videos/:id` mỗi 3 giây, đọc `status` field từ DB:

```
pending → processing → completed
                    ↘ failed
```

### 5.3 Module Setup (không cần BullMQ)

```ts
// app.module.ts — chỉ cần TypeORM + CacheModule (memory)
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ ... }),
    CacheModule.register({ isGlobal: true, ttl: 3600, max: 100 }),
    // Không có BullModule, không có Redis
  ],
})
export class AppModule {}
```

### 5.4 So sánh với BullMQ

| | Simple Async | BullMQ |
|---|---|---|
| Dependencies | Không cần gì thêm | Redis bắt buộc |
| Setup | 0 config | Redis + BullModule |
| Retry | Manual try/catch | Built-in |
| Job persistence | Không (mất khi restart) | Có |
| Phù hợp local | ✅ | ❌ overkill |
| Phù hợp production | ❌ | ✅ |

---

## 6. LLM Abstraction Layer

### 6.1 `LLMService` Interface

```ts
interface LLMCompletionRequest {
  system: string;
  context?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  query: string;
  maxTokens?: number;
  temperature?: number;
}

interface LLMCompletionResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}
```

### 6.2 Provider Selection (via `LLM_PROVIDER` env)

```
LLM_PROVIDER=openai   → calls OpenAI Chat Completions API
LLM_PROVIDER=ollama   → calls Ollama local API (http://localhost:11434)
```

### 6.3 System Prompt Templates

#### Summary Prompt
```
Bạn là chuyên gia tóm tắt nội dung giáo dục.
Dựa trên transcript sau, hãy tạo:
1. Danh sách bullet points các ý chính (tối đa 10 điểm)
2. Đoạn tóm tắt dễ hiểu (3-5 câu)
3. Danh sách chủ đề chính

Transcript: {transcript}

Trả lời bằng JSON: { key_points: string[], simplified_text: string, main_topics: string[] }
```

#### Quiz Prompt
```
Dựa trên nội dung sau, tạo {n} câu hỏi trắc nghiệm (4 đáp án, 1 đúng).
Đa dạng chủ đề. Đặt câu hỏi rõ ràng, không mơ hồ.

Context: {context}

Trả lời bằng JSON array:
[{ question_text, options: {A,B,C,D}, correct_option, explanation }]
```

#### Flashcard Prompt
```
Dựa trên nội dung sau, tạo {n} flashcard để ghi nhớ kiến thức.
Mỗi flashcard: mặt trước (khái niệm/câu hỏi ngắn), mặt sau (giải thích đầy đủ).

Context: {context}

Trả lời bằng JSON array: [{ front, back }]
```

---

## 7. Caching Strategy (In-Memory)

Không dùng Redis. Sử dụng **NestJS built-in in-memory cache** (`@nestjs/cache-manager` với memory store mặc định) — không cần cài đặt thêm gì.

```ts
// app.module.ts
CacheModule.register({
  isGlobal: true,
  ttl: 3600,  // seconds
  max: 100,   // max items in memory
})
```

```ts
// summary.controller.ts
@UseInterceptors(CacheInterceptor)
@CacheTTL(3600)
@Get(':id/summary')
async getSummary(@Param('id') id: string) { ... }
```

| Endpoint | Cache TTL | Ghi chú |
|---|---|---|
| `GET /videos/:id` | 60 giây | Cập nhật khi status thay đổi |
| `GET /videos/:id/summary` | 3600 giây (1h) | Bất biến sau khi tạo |
| `GET /videos/:id/quiz` | 86400 giây (24h) | Bất biến sau khi tạo |
| `GET /flashcard-sets/:id` | 86400 giây (24h) | Bất biến sau khi tạo |
| `GET /chat/sessions/:id/messages` | Không cache | Luôn lấy fresh |

Cache tự mất khi server restart — không ảnh hưởng vì data vẫn trong SQLite.

---

## 8. Configuration & Environment

### `.env.example`

```env
# Server
PORT=4000
NODE_ENV=development

# Database
DB_TYPE=sqlite
DB_PATH=./data/app.db
# For PostgreSQL:
# DB_TYPE=postgres
# DB_HOST=localhost
# DB_PORT=5432
# DB_USERNAME=postgres
# DB_PASSWORD=password
# DB_NAME=ai_video_assistant

# Qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=video_chunks

# LLM
LLM_PROVIDER=openai          # openai | ollama
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b

# Embedding
EMBEDDING_PROVIDER=openai    # openai | local
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
LOCAL_EMBEDDING_MODEL=multilingual-e5-base
EMBEDDING_DIMENSION=1536

# Processing
CHUNK_SIZE=500
CHUNK_OVERLAP=50
TOP_K_RETRIEVAL=5
MAX_QUIZ_QUESTIONS=10
MAX_FLASHCARDS=15
```

### Typed Configuration

```ts
// configuration.ts
export default () => ({
  port: parseInt(process.env.PORT || '4000'),
  llm: {
    provider: process.env.LLM_PROVIDER || 'openai',
    openai: { apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL },
    ollama: { baseUrl: process.env.OLLAMA_BASE_URL, model: process.env.OLLAMA_MODEL },
  },
  embedding: {
    provider: process.env.EMBEDDING_PROVIDER || 'openai',
    dimension: parseInt(process.env.EMBEDDING_DIMENSION || '1536'),
  },
  rag: {
    chunkSize: parseInt(process.env.CHUNK_SIZE || '500'),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '50'),
    topK: parseInt(process.env.TOP_K_RETRIEVAL || '5'),
  },
});
```

---

## 9. Error Handling

### Global Exception Filter

```ts
@Catch(HttpException, QueryFailedError)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = 500;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    } else if (exception instanceof QueryFailedError) {
      status = 400;
      message = 'Database query failed';
    }

    response.status(status).json({
      statusCode: status,
      message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

### Error Codes

| Code | Meaning |
|---|---|
| `400` | Invalid YouTube URL / bad request |
| `404` | Video / session / resource not found |
| `409` | Video already being processed |
| `422` | Transcript extraction failed |
| `429` | LLM API rate limit hit |
| `500` | Internal server / embedding error |
| `503` | Qdrant unavailable |

---

## 10. Database Setup (TypeORM)

```ts
// app.module.ts
TypeOrmModule.forRootAsync({
  imports: [ConfigModule],
  useFactory: (config: ConfigService) => ({
    type: config.get('DB_TYPE') as 'sqlite' | 'postgres',
    database: config.get('DB_PATH'),      // SQLite
    // host, port, username, password, database  // PostgreSQL
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    synchronize: config.get('NODE_ENV') !== 'production',
    logging: config.get('NODE_ENV') === 'development',
  }),
  inject: [ConfigService],
}),
```

**Note:** `synchronize: true` is safe for local development. For production upgrades, use TypeORM migrations.
