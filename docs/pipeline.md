# Development Pipeline
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  
**Stack:** NestJS (backend) · React + Vite (frontend) · SQLite · Qdrant · OpenAI / Ollama  

---

## Tổng quan luồng code

```
Phase 0 → Setup & Scaffold
Phase 1 → Backend Foundation (NestJS core, DB, Config)
Phase 2 → Video Module (CRUD + background processing hook)
Phase 3 → Transcript Module (YouTube caption + Whisper fallback)
Phase 4 → RAG Module (Chunking → Embedding → Qdrant)
Phase 5 → LLM Abstraction + Summary Module
Phase 6 → Wire Full Ingestion Pipeline (background task)
Phase 7 → Chat Module (RAG query + LLM response)
Phase 8 → Quiz Module (LLM generation)
Phase 9 → Flashcard Module (LLM generation)
Phase 10 → Frontend Setup (Vite, Router, Store, API client)
Phase 11 → Frontend Pages & Components
Phase 12 → Integration, Polish & E2E Smoke Test
```

> **Quy tắc chung:** Mỗi phase phải pass test trước khi chuyển sang phase tiếp theo.  
> Backend chạy port `4000`, Frontend port `3000`, Qdrant port `6333`.

---

## Phase 0 — Project Setup & Scaffold

### Mục tiêu
Tạo cấu trúc thư mục, cài dependencies, cấu hình môi trường.

### Việc cần làm

**Cấu trúc workspace:**
```
project-root/
├── backend/    ← NestJS
├── frontend/   ← React + Vite
└── docs/
```

**Backend scaffold:**
```bash
nest new backend --package-manager npm
cd backend
npm install @nestjs/config @nestjs/typeorm typeorm better-sqlite3
npm install @nestjs/cache-manager cache-manager
npm install @qdrant/js-client-rest
npm install openai
npm install youtube-transcript
npm install class-validator class-transformer
npm install @nestjs/swagger swagger-ui-express
```

**Frontend scaffold:**
```bash
npm create vite@latest frontend -- --template react-ts
cd frontend
npm install react-router-dom @tanstack/react-query zustand axios
npm install tailwindcss @tailwindcss/vite
npm install lucide-react
# shadcn/ui: npx shadcn@latest init
```

**Tạo file `.env` trong `backend/`** (copy từ `.env.example`):
```
PORT=4000
NODE_ENV=development
DB_TYPE=sqlite
DB_PATH=./data/app.db
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_COLLECTION=video_chunks
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
EMBEDDING_PROVIDER=openai
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSION=1536
CHUNK_SIZE=500
CHUNK_OVERLAP=50
TOP_K_RETRIEVAL=5
```

**Khởi động Qdrant** (download binary từ qdrant.tech):
```bash
./qdrant   # chạy trên localhost:6333
```

### Test Phase 0
- [ ] `npm run start:dev` (backend) → server lắng nghe port 4000
- [ ] `npm run dev` (frontend) → trang trắng tại port 3000
- [ ] `curl http://localhost:6333/` → Qdrant trả về health OK
- [ ] `curl http://localhost:4000/api` → NestJS trả về 404 (chưa có route)

---

## Phase 1 — Backend Foundation

### Mục tiêu
NestJS core hoàn chỉnh: Config, TypeORM (SQLite), CacheModule, global exception filter, Swagger.

### Files cần tạo

| File | Nội dung |
|---|---|
| `src/main.ts` | Bootstrap, Swagger setup, ValidationPipe global, port 4000 |
| `src/app.module.ts` | Import ConfigModule (global), TypeOrmModule (async), CacheModule (global) |
| `src/config/configuration.ts` | Typed config object (llm, embedding, rag, db) |
| `src/common/filters/http-exception.filter.ts` | Global exception filter → shape `{statusCode, message, timestamp}` |
| `src/common/interceptors/logging.interceptor.ts` | Log mỗi request: method, url, duration |

**`app.module.ts` skeleton:**
```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3',
        database: config.get('db.path'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: true,
        logging: config.get('nodeEnv') === 'development',
      }),
      inject: [ConfigService],
    }),
    CacheModule.register({ isGlobal: true, ttl: 3600, max: 100 }),
  ],
})
export class AppModule {}
```

### Test Phase 1
- [ ] `npm run start:dev` không có lỗi compile
- [ ] `GET http://localhost:4000/api` → `{"statusCode":404,"message":"...","timestamp":"..."}`
- [ ] `GET http://localhost:4000/api-docs` → Swagger UI load thành công
- [ ] `data/app.db` được tạo ra (SQLite file)

---

## Phase 2 — Video Module

### Mục tiêu
CRUD video: nhận URL, validate, lưu DB, trả về status. **Chưa** xử lý AI — chỉ quản lý vòng đời video.

### Files cần tạo

```
src/modules/video/
├── video.module.ts
├── video.controller.ts     ← POST /videos, GET /videos, GET /videos/:id
│                              DELETE /videos/:id, POST /videos/:id/reprocess
├── video.service.ts        ← create, findAll, findById, updateStatus, delete
├── video.entity.ts         ← id, youtube_id, url, title, status, error_message, timestamps
└── dto/
    ├── create-video.dto.ts    ← @IsUrl(), validate YouTube URL pattern
    └── video-response.dto.ts
```

**Logic quan trọng trong `video.service.ts`:**
```ts
async create(url: string): Promise<VideoEntity> {
  const youtubeId = this.extractYoutubeId(url);   // parse ?v= from URL
  const existing = await this.videoRepo.findOne({ where: { youtubeId } });
  if (existing) throw new ConflictException({ message: 'Video already processed', existingId: existing.id });

  const video = await this.videoRepo.save({ url, youtubeId, status: 'pending' });
  // Phase 6 sẽ thêm: this.processVideoInBackground(video.id).catch(...)
  return video;
}
```

**`create-video.dto.ts`:** dùng `@Matches(/youtube\.com\/watch\?v=[\w-]{11}/)` để validate URL.

### Test Phase 2
```bash
# Tạo video
curl -X POST http://localhost:4000/api/videos \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
# → 202 Accepted, status: "pending"

# Lấy danh sách
curl http://localhost:4000/api/videos
# → [{id, youtubeId, status: "pending", ...}]

# Tạo trùng → conflict
curl -X POST ... same URL
# → 409 { message: "Video already processed", existingId: "..." }

# URL sai → validation error
curl -X POST ... -d '{"url":"not-a-youtube-url"}'
# → 400
```
- [ ] Unit test `video.service.spec.ts`: mock `videoRepo`, test `create()`, `findById()`, duplicate check

---

## Phase 3 — Transcript Module

### Mục tiêu
Trích xuất transcript từ YouTube caption API. Fallback sang Whisper nếu không có caption.

### Files cần tạo

```
src/modules/transcript/
├── transcript.module.ts
├── transcript.service.ts          ← orchestrate: try caption → fallback whisper
├── youtube-caption.service.ts     ← dùng 'youtube-transcript' npm package
├── whisper.service.ts             ← OpenAI Whisper API hoặc local
└── transcript.entity.ts           ← id, video_id, raw_text, source, word_count
```

**`youtube-caption.service.ts`:**
```ts
async fetch(youtubeId: string): Promise<string | null> {
  try {
    const segments = await YoutubeTranscript.fetchTranscript(youtubeId, { lang: 'vi' });
    if (!segments?.length) {
      // try English fallback
      const en = await YoutubeTranscript.fetchTranscript(youtubeId, { lang: 'en' });
      if (!en?.length) return null;
      return en.map(s => s.text).join(' ');
    }
    return segments.map(s => s.text).join(' ');
  } catch {
    return null;
  }
}
```

**Post-processing:** clean transcript (remove `[Music]`, collapse whitespace, remove stutters).

**`transcript.service.ts`:** gọi `YouTubeCaptionService.fetch()` → nếu null thì `WhisperService.transcribe()` → lưu vào DB.

### Test Phase 3
```bash
# Gọi trực tiếp transcript service (tạm thời expose endpoint test)
curl -X POST http://localhost:4000/api/transcript/test \
  -d '{"youtubeId": "dQw4w9WgXcQ"}'
# → { raw_text: "...", source: "youtube_caption", word_count: 1200 }
```
- [ ] Unit test `transcript.service.spec.ts`: mock `YouTubeCaptionService`, test fallback logic
- [ ] Unit test `youtube-caption.service.spec.ts`: mock `youtube-transcript` package
- [ ] Kiểm tra bằng tay với 1 video có caption tiếng Việt

---

## Phase 4 — RAG Module

### Mục tiêu
Pipeline: text → chunks → embeddings → upsert Qdrant. Đây là **core của hệ thống**.

### Files cần tạo

```
src/modules/rag/
├── rag.module.ts
├── rag.service.ts             ← orchestrate: indexTranscript(), retrieve()
├── chunking.service.ts        ← sliding window, sentence-aware split
├── embedding.service.ts       ← OpenAI text-embedding-3-small hoặc local
├── vector-store.service.ts    ← Qdrant: upsert, search, delete
└── chunk.entity.ts            ← id, video_id, transcript_id, content, chunk_index, token_count
```

**Thứ tự implement trong Phase 4:**

**4a. `chunking.service.ts`** — thuần TypeScript, không phụ thuộc API:
- `chunk(text, transcriptId, videoId): ChunkEntity[]`
- Sliding window: 500 tokens, 50 overlap
- Vietnamese sentence splitter: `/(?<=[.!?])\s+(?=[A-ZÁÀẢÃ...])/gu`
- Token estimate: `Math.ceil(text.length * 0.75)` (chars → tokens approx)

**4b. `embedding.service.ts`** — gọi OpenAI API (hoặc local):
- `embedBatch(texts: string[]): Promise<number[][]>` — batch 20 texts/call
- `embedSingle(text: string): Promise<number[]>`
- Config `EMBEDDING_PROVIDER` để switch giữa `openai` và `local`

**4c. `vector-store.service.ts`** — Qdrant client:
- Tạo collection `video_chunks` khi khởi động (nếu chưa tồn tại)
- `upsertChunks(chunks, vectors)`: upsert vào Qdrant với payload `{video_id, content, chunk_index}`
- `search(queryVector, videoId, topK=5)`: filter by `video_id`, threshold `score >= 0.6`
- `deleteByVideoId(videoId)`: xoá khi video bị delete

**4d. `rag.service.ts`** — orchestrator:
- `indexTranscript(transcript)`: chunk → embed → upsert → update `chunk.embedding_id`
- `retrieve(query, videoId, topK)`: embedSingle → search Qdrant → return `RetrievedChunk[]`

### Test Phase 4
```bash
# Unit test chunking (không cần API)
npm run test -- chunking.service.spec.ts
# → test với transcript mẫu: output đúng số chunks, overlap đúng
```
- [ ] Unit test `chunking.service.spec.ts`: text mẫu → verify chunk count, overlap, no empty chunks
- [ ] Unit test `embedding.service.spec.ts`: mock OpenAI client, verify batch size = 20, retry on error
- [ ] Unit test `vector-store.service.spec.ts`: mock QdrantClient, verify upsert payload format
- [ ] Unit test `rag.service.spec.ts`: mock tất cả deps, verify indexTranscript gọi đúng thứ tự
- [ ] Integration test: index 1 transcript thật → query Qdrant → verify results > 0

---

## Phase 5 — LLM Abstraction + Summary Module

### Mục tiêu
`LLMService` là interface duy nhất cho mọi LLM call (chat, summary, quiz, flashcard). `SummaryModule` dùng LLM để tạo summary.

### Files cần tạo

```
src/common/llm/
├── llm.module.ts
├── llm.service.ts        ← switch OpenAI | Ollama theo LLM_PROVIDER
├── llm.types.ts          ← LLMCompletionRequest, LLMCompletionResponse
└── prompts.ts            ← TẤT CẢ prompt templates (summary, quiz, flashcard, chat)

src/modules/summary/
├── summary.module.ts
├── summary.controller.ts   ← GET /videos/:videoId/summary
├── summary.service.ts      ← generate(), findByVideoId()
└── summary.entity.ts       ← id, video_id, key_points (JSON), simplified_text, main_topics (JSON)
```

**`llm.types.ts`:**
```ts
interface LLMCompletionRequest {
  system: string;
  context?: string;
  history?: { role: 'user' | 'assistant'; content: string }[];
  query: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;   // khi cần parse JSON output
}
```

**`prompts.ts`** — tất cả template tập trung tại đây (theo `rule.md`):
- `SUMMARY_PROMPT` — key_points + simplified_text + main_topics
- `QUIZ_PROMPT` — MCQ 4 options, explanation
- `FLASHCARD_PROMPT` — front/back pairs
- `CHAT_SYSTEM_PROMPT` — anti-hallucination, cite sources

**`summary.service.ts`:**
- Nếu transcript < 4000 tokens → 1 LLM call
- Nếu dài hơn → map-reduce: chia thành nhóm 4000 tokens, tóm tắt từng nhóm → combine
- Parse JSON output, lưu `key_points` / `main_topics` dưới dạng JSONB

### Test Phase 5
- [ ] Unit test `llm.service.spec.ts`: mock OpenAI client, verify request format, test retry (mock 429)
- [ ] Unit test `summary.service.spec.ts`: mock LLMService, verify output parsing, JSON validation
- [ ] Manual test: `GET /api/videos/:id/summary` sau khi tạo summary thủ công
- [ ] Kiểm tra response có đúng shape `{keyPoints[], simplifiedText, mainTopics[]}`

---

## Phase 6 — Wire Full Ingestion Pipeline

### Mục tiêu
Kết nối tất cả modules thành 1 background task hoàn chỉnh: URL → transcript → chunks → embeddings → summary → status = completed.

### Thay đổi chính trong `video.service.ts`

```ts
async create(url: string): Promise<VideoEntity> {
  // ... (từ Phase 2)
  const video = await this.videoRepo.save({ url, youtubeId, status: 'pending' });

  // Thêm mới: fire-and-forget
  this.processVideoInBackground(video.id).catch(err =>
    this.logger.error(`Pipeline failed for ${video.id}`, err.stack)
  );

  return video;
}

private async processVideoInBackground(videoId: string): Promise<void> {
  await this.videoRepo.update(videoId, { status: 'processing' });
  try {
    const video = await this.findById(videoId);
    const transcript = await this.transcriptService.extract(videoId, video.youtubeId);
    await this.ragService.indexTranscript(transcript);
    await this.summaryService.generate(videoId, transcript);
    await this.videoRepo.update(videoId, { status: 'completed' });
  } catch (err) {
    await this.videoRepo.update(videoId, { status: 'failed', errorMessage: err.message });
  }
}
```

**Module imports cần update:**
- `VideoModule` imports `[TranscriptModule, RAGModule, SummaryModule]`

### Test Phase 6 — Critical Path Test
```bash
# 1. Submit video
curl -X POST http://localhost:4000/api/videos \
  -d '{"url":"https://www.youtube.com/watch?v=<REAL_VIDEO_ID>"}'
# → 202 { status: "pending" }

# 2. Poll status every 3s
curl http://localhost:4000/api/videos/<id>
# → pending → processing → completed

# 3. Khi completed, kiểm tra summary
curl http://localhost:4000/api/videos/<id>/summary
# → { keyPoints: [...], simplifiedText: "...", mainTopics: [...] }

# 4. Kiểm tra Qdrant có data
curl http://localhost:6333/collections/video_chunks/points/count
# → { count: N } (N > 0)
```
- [ ] E2E test với video thực tế
- [ ] Test failed case: submit video không có caption, không config Whisper → status = "failed"
- [ ] Test reprocess: `POST /videos/:id/reprocess` → trạng thái reset về pending → chạy lại

---

## Phase 7 — Chat Module

### Mục tiêu
RAG chatbot: tạo session → gửi message → nhận câu trả lời từ context video.

### Files cần tạo

```
src/modules/chat/
├── chat.module.ts
├── chat.controller.ts     ← POST /chat/sessions, GET /chat/sessions
│                             GET /chat/sessions/:id/messages
│                             POST /chat/sessions/:id/messages
│                             DELETE /chat/sessions/:id
├── chat.service.ts        ← createSession(), sendMessage() (full RAG flow)
├── session.entity.ts      ← id, video_id, title, timestamps
└── message.entity.ts      ← id, session_id, role, content, retrieved_chunks (JSON)
```

**`chat.service.ts` — `sendMessage()` flow:**
1. Lưu user message vào DB
2. `ragService.retrieve(query, videoId)` → lấy top-5 chunks
3. Nếu tất cả scores < 0.6 → trả về fallback `"Thông tin này không có trong video."`
4. Lấy 6 messages gần nhất làm history
5. Build prompt từ `CHAT_SYSTEM_PROMPT` + context + history + query
6. `llmService.complete(prompt, { temperature: 0.2 })`
7. Lưu assistant message với `retrieved_chunks: [chunkId1, chunkId2, ...]`
8. Return assistant message

### Test Phase 7
```bash
# Tạo session
curl -X POST http://localhost:4000/api/chat/sessions \
  -d '{"videoId":"<completed-video-id>"}'
# → { id: "session-id", videoId: "...", title: "New Chat" }

# Gửi message
curl -X POST http://localhost:4000/api/chat/sessions/<session-id>/messages \
  -d '{"content":"Video này nói về chủ đề gì?"}'
# → { role: "assistant", content: "...", retrievedChunks: [{chunkId, content, score}] }

# Câu hỏi ngoài context
curl -X POST ... -d '{"content":"Tổng thống Mỹ là ai?"}'
# → { content: "Thông tin này không có trong video.", retrievedChunks: [] }
```
- [ ] Unit test `chat.service.spec.ts`: mock RAGService + LLMService, verify prompt structure
- [ ] Test fallback khi score < 0.6
- [ ] Test history: sau 7+ turns, chỉ lấy 6 message cuối
- [ ] Test delete session → messages bị cascade delete

---

## Phase 8 — Quiz Module

### Mục tiêu
Generate MCQ quiz từ video content dùng LLM với chunk sampling.

### Files cần tạo

```
src/modules/quiz/
├── quiz.module.ts
├── quiz.controller.ts      ← POST /videos/:id/quiz, GET /videos/:id/quiz, DELETE /videos/:id/quiz
├── quiz.service.ts         ← generate(), findByVideoId(), delete()
├── quiz.entity.ts          ← id, video_id, title, total_questions
└── quiz-question.entity.ts ← id, quiz_id, question_text, options (JSON), correct_option, explanation
```

**`quiz.service.ts` — `generate()` logic:**
1. Fetch all chunks cho video → sample đều (20 chunks max)
2. Chia thành batches 4 chunks → generate 5 questions/batch
3. Parse JSON response → validate (4 options, correct_option ∈ {A,B,C,D})
4. Lưu `Quiz` + `QuizQuestion[]` vào DB
5. Idempotent: nếu quiz đã tồn tại → return existing

### Test Phase 8
```bash
# Generate quiz
curl -X POST http://localhost:4000/api/videos/<id>/quiz \
  -d '{"numQuestions": 10}'
# → { id, totalQuestions: 10, questions: [{questionText, options: {A,B,C,D}, correctOption, explanation}] }

# Lấy quiz đã có
curl http://localhost:4000/api/videos/<id>/quiz
# → same structure (200 OK)

# Delete để regenerate
curl -X DELETE http://localhost:4000/api/videos/<id>/quiz
# → { message: "Quiz deleted" }
```
- [ ] Unit test `quiz.service.spec.ts`: mock LLMService + ChunkRepo, verify batch logic, JSON parsing
- [ ] Test idempotency: gọi POST 2 lần → không tạo quiz thứ 2
- [ ] Test with real LLM: câu hỏi phải liên quan đến nội dung video

---

## Phase 9 — Flashcard Module

### Mục tiêu
Generate flashcards Q&A pairs từ video content.

### Files cần tạo

```
src/modules/flashcard/
├── flashcard.module.ts
├── flashcard.controller.ts    ← POST /videos/:id/flashcards, GET, DELETE
├── flashcard.service.ts       ← generate(), findByVideoId()
├── flashcard-set.entity.ts    ← id, video_id, title, total_cards
└── flashcard.entity.ts        ← id, set_id, front, back, card_index
```

**`flashcard.service.ts` — tương tự Quiz nhưng dùng `FLASHCARD_PROMPT`:**
- Sample diverse chunks từ video
- Generate 8 cards/batch (token budget nhỏ hơn)
- Validate: `front` max 15 words, `back` 2-4 câu

### Test Phase 9
```bash
# Generate flashcards
curl -X POST http://localhost:4000/api/videos/<id>/flashcards \
  -d '{"numCards": 15}'
# → { id, totalCards: 15, cards: [{front: "...", back: "..."}] }
```
- [ ] Unit test `flashcard.service.spec.ts`: mock LLMService, verify front/back structure
- [ ] Test idempotency
- [ ] Test với video thực: các card phải có nội dung từ video

---

## Phase 10 — Frontend Setup

### Mục tiêu
Scaffold React app với routing, state management, API client, design system.

### Files cần tạo / cấu hình

**`src/main.tsx`** — QueryClientProvider + BrowserRouter + ToastProvider

**`src/App.tsx`** — route table:
```tsx
<Routes>
  <Route path="/" element={<AppLayout />}>
    <Route index element={<HomePage />} />
    <Route path="video/:videoId" element={<VideoPage />} />
    <Route path="video/:videoId/chat" element={<ChatPage />} />
    <Route path="video/:videoId/quiz" element={<QuizPage />} />
    <Route path="video/:videoId/flashcards" element={<FlashcardPage />} />
  </Route>
</Routes>
```

**`src/services/api.ts`** — typed Axios client:
- Base URL: `import.meta.env.VITE_API_URL || 'http://localhost:4000/api'`
- Global interceptor: toast error on non-2xx
- Timeout: 30s
- Export: `api.createVideo()`, `api.getVideo()`, `api.listVideos()`, `api.getSummary()`, `api.createSession()`, `api.sendMessage()`, `api.generateQuiz()`, `api.getQuiz()`, `api.generateFlashcards()`, `api.getFlashcards()`

**`src/store/useAppStore.ts`** — Zustand:
- `currentVideoId`, `currentSessionId`
- `quizAnswers: Record<string, string>`, `resetQuiz()`
- `currentCardIndex`, `isCardFlipped`, `toggleFlip()`

**`src/types/index.ts`** — TypeScript interfaces cho tất cả API responses (Video, Summary, ChatMessage, Quiz, FlashcardSet...)

**`src/lib/utils.ts`** — `cn()` helper (clsx + tailwind-merge)

**shadcn/ui components cần install:**
```bash
npx shadcn@latest add button input card badge skeleton tooltip progress scroll-area separator
```

### Test Phase 10
- [ ] `npm run dev` → frontend load tại port 3000, không có console error
- [ ] Route `/` → HomePage render (trống)
- [ ] `api.listVideos()` trong browser console → trả về array từ backend
- [ ] Zustand store hoạt động (kiểm tra với Redux DevTools)

---

## Phase 11 — Frontend Pages & Components

### Thứ tự implement từng component

#### 11a. Layout (AppLayout + Sidebar + Header)
```
src/components/layout/
├── AppLayout.tsx    ← shell: sidebar trái + main content
├── Sidebar.tsx      ← danh sách video đã xử lý (từ useQuery listVideos)
└── Header.tsx       ← logo + dark mode toggle
```
**Test:** Layout render đúng, Sidebar hiện danh sách video từ API

#### 11b. HomePage + VideoInputForm
```
src/components/video/
├── VideoInputForm.tsx   ← URL input, validate YouTube pattern, submit → POST /videos
├── VideoCard.tsx        ← hiện title, status badge (pending/processing/completed/failed)
└── ProcessingStatus.tsx ← spinner + status text khi pending/processing
```

**`useVideoProcessing` hook:**
```ts
// Poll video status every 3s until completed/failed
const { data: video } = useQuery({
  queryKey: ['video', videoId],
  queryFn: () => api.getVideo(videoId),
  refetchInterval: (data) => 
    ['completed', 'failed'].includes(data?.status) ? false : 3000,
});
```

**Test 11b:**
- [ ] Submit URL → spinner xuất hiện → auto-navigate đến `/video/:id` khi completed
- [ ] Submit URL sai → hiện validation error ngay trên form
- [ ] Submit URL trùng → toast "Video đã được xử lý trước đó"

#### 11c. VideoPage + SummaryCard
```
src/pages/VideoPage.tsx      ← hiện summary + navigation cards (Chat/Quiz/Flashcard)
src/components/video/SummaryCard.tsx  ← key_points list + simplified_text + main_topics chips
```
**Test:** `GET /videos/:id/summary` → render đúng key_points, simplifiedText, mainTopics

#### 11d. ChatPage + ChatWindow + MessageBubble + ChatInput + SourceChips
```
src/pages/ChatPage.tsx
src/components/chat/
├── ChatWindow.tsx      ← ScrollArea, auto-scroll to bottom
├── MessageBubble.tsx   ← user (right, indigo) | assistant (left, gray) + SourceChips
├── ChatInput.tsx       ← textarea + send button, Enter to submit
└── SourceChips.tsx     ← hiện chunk content dạng tooltip khi hover
```

**`useChat` hook:**
- Auto-create session nếu chưa có
- `useMutation` cho `sendMessage`
- Optimistic update: hiện typing indicator ngay khi gửi

**Test 11d:**
- [ ] Gõ câu hỏi → hiện typing indicator → nhận reply
- [ ] SourceChips hiện đúng chunks liên quan
- [ ] Câu hỏi ngoài context → hiện "Thông tin này không có trong video."
- [ ] Scroll auto về cuối khi có message mới

#### 11e. QuizPage + QuizContainer + QuestionCard + QuizResult
```
src/pages/QuizPage.tsx
src/components/quiz/
├── QuizContainer.tsx    ← orchestrate: loading → questions → result
├── QuestionCard.tsx     ← hiện question + 4 options
├── OptionButton.tsx     ← click → highlight, lock selection
└── QuizResult.tsx       ← score/total + review table (đúng/sai + explanation)
```

**`useQuiz` hook** — state machine:
- `idle` → `loading` → `active` → `completed`
- Track `currentIndex`, `answers{questionId → selectedOption}`, `score`

**Test 11e:**
- [ ] "Generate Quiz" button → spinner → quiz load
- [ ] Chọn đáp án → highlight, submit → ✓/✗ + explanation
- [ ] Quiz result screen: tổng điểm đúng
- [ ] Không generate lại nếu quiz đã có (idempotent)

#### 11f. FlashcardPage + FlashcardViewer + FlipCard + CardProgress
```
src/pages/FlashcardPage.tsx
src/components/flashcard/
├── FlashcardViewer.tsx  ← navigation: Prev/Next, keyboard arrow keys
├── FlipCard.tsx         ← CSS 3D flip animation (rotateY 180deg)
└── CardProgress.tsx     ← "3 / 15" indicator
```

**FlipCard CSS:**
```css
.flip-card { perspective: 1000px; }
.flip-card-inner { transition: transform 0.6s; transform-style: preserve-3d; }
.flip-card.flipped .flip-card-inner { transform: rotateY(180deg); }
.flip-card-front, .flip-card-back { backface-visibility: hidden; }
.flip-card-back { transform: rotateY(180deg); }
```

**Test 11f:**
- [ ] Click card → flip animation mượt
- [ ] Next/Prev navigate đúng card
- [ ] CardProgress cập nhật đúng
- [ ] Keyboard: ArrowLeft/ArrowRight navigate, Space để flip

---

## Phase 12 — Integration, Polish & E2E Smoke Test

### Mục tiêu
Full E2E test, xử lý edge cases, loading states, error states.

### Checklist Integration

**Error states:**
- [ ] Video `status: "failed"` → hiện nút "Reprocess" thay vì nội dung
- [ ] API down → toast error với "Thử lại" button
- [ ] `GET /summary` 404 (video chưa xong) → skeleton + "Đang xử lý..."

**Loading states:**
- [ ] Skeleton cards khi loading danh sách video
- [ ] Full-page skeleton khi generating quiz/flashcards
- [ ] Typing indicator trong chat khi đang chờ AI

**Empty states:**
- [ ] Không có video: "Nhập URL YouTube để bắt đầu"
- [ ] Chưa có quiz: "Chưa có bài kiểm tra — Tạo ngay"
- [ ] Chat trống: "Hỏi bất kỳ điều gì về video này..."

**Dark mode:** Toggle trong Header, `class` strategy Tailwind.

**Vietnamese text:** Test với 1-2 video YouTube tiếng Việt.

### Full E2E Smoke Test (Manual)

```
1. Khởi động: Qdrant → backend → frontend

2. Submit YouTube URL tiếng Việt
   → Kiểm tra: pending → processing → completed trong ~60s

3. Vào VideoPage
   → Kiểm tra: summary hiện đúng key_points, mainTopics

4. Vào ChatPage
   → Hỏi 3 câu trong context → answers có sources
   → Hỏi 1 câu ngoài context → fallback message

5. Vào QuizPage
   → Generate 10 câu hỏi
   → Làm quiz, kiểm tra scoring

6. Vào FlashcardPage
   → Generate 15 cards
   → Flip cards, navigate

7. Delete video từ danh sách
   → Kiểm tra: video xoá, cascade xoá summary/quiz/flashcards
   → Kiểm tra: Qdrant points bị xoá (count = 0 cho video_id đó)
```

### Unit Test Coverage Target

| Module | Target coverage |
|---|---|
| `chunking.service` | ≥ 90% |
| `embedding.service` | ≥ 80% |
| `vector-store.service` | ≥ 80% |
| `rag.service` | ≥ 85% |
| `video.service` | ≥ 85% |
| `chat.service` | ≥ 85% |
| `quiz.service` | ≥ 80% |
| `flashcard.service` | ≥ 80% |
| `summary.service` | ≥ 80% |

```bash
# Chạy tất cả unit tests
npm run test

# Xem coverage report
npm run test:cov
```

---

## Dependency Map (Build Order)

```
Phase 0 (Setup)
    │
Phase 1 (NestJS Core)
    │
Phase 2 (Video CRUD)         ← test riêng
    │
Phase 3 (Transcript)         ← test riêng
    │
Phase 4 (RAG: Chunk+Embed)   ← test riêng (quan trọng nhất)
    │
Phase 5 (LLM + Summary)      ← test riêng
    │
Phase 6 (Wire Pipeline) ← Phase 2+3+4+5 đều phải pass trước
    │
Phase 7 (Chat)               ← depends on Phase 4 + Phase 5
Phase 8 (Quiz)               ← depends on Phase 4 + Phase 5
Phase 9 (Flashcard)          ← depends on Phase 5 only
    │
Phase 10 (FE Setup)          ← song song với Phase 7-9
    │
Phase 11 (FE Pages)          ← depends on Phase 10 + all backend phases
    │
Phase 12 (Integration)       ← tất cả phải xong
```

> **Phase 7, 8, 9 có thể code song song** sau khi Phase 6 xong.  
> **Phase 10 có thể bắt đầu song song** từ Phase 6 vì chỉ cần API contract (đã có trong `api design.md`).

---

## Estimated Timeline (1 developer)

| Phase | Estimated Time | Notes |
|---|---|---|
| Phase 0 | 1–2 giờ | Scaffold + env setup |
| Phase 1 | 2–3 giờ | NestJS boilerplate |
| Phase 2 | 3–4 giờ | Video CRUD + tests |
| Phase 3 | 3–4 giờ | Transcript extraction + tests |
| Phase 4 | 6–8 giờ | RAG core — nhiều nhất |
| Phase 5 | 4–5 giờ | LLM + Summary |
| Phase 6 | 2–3 giờ | Wire everything |
| Phase 7 | 4–5 giờ | Chat + RAG query |
| Phase 8 | 3–4 giờ | Quiz generation |
| Phase 9 | 2–3 giờ | Flashcard generation |
| Phase 10 | 3–4 giờ | FE scaffold |
| Phase 11 | 8–10 giờ | All pages + components |
| Phase 12 | 3–4 giờ | Polish + E2E |
| **Tổng** | **~48–59 giờ** | ~1–1.5 tuần full-time |
