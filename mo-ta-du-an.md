# Mo ta du an Video Sum

## 1. Tong quan

Video Sum la ung dung ho tro hoc tap tu video YouTube. Nguoi dung nhap URL video, backend lay transcript, lam sach text, chia transcript thanh chunk, tao tom tat, tao bai trac nghiem va cho phep chat hoi dap dua tren noi dung video.

Du an hien la MVP full-stack gom:

- Backend: NestJS, TypeScript, Prisma va PostgreSQL.
- Frontend: React, Vite, React Query, Zustand, Tailwind CSS va Axios.
- AI/RAG: LangChain, Groq OpenAI-compatible API, chunk grounding va local hash embeddings.
- Evaluation: script DeepEval de danh gia chat RAG va summary.

Muc tieu san pham:

- bien video hoc tap thanh tai lieu hoc nhanh;
- giu transcript va chunk lam nguon bang chung chinh;
- tao summary, quiz va chat co kha nang truy ve nguon;
- ho tro workflow hoc Toan, uu tien noi dung chinh xac theo transcript.

## 2. Cong nghe su dung

### Backend

- NestJS 11 lam framework API.
- TypeScript lam ngon ngu chinh.
- Prisma 6.19.3 lam ORM.
- PostgreSQL lam database chinh.
- `youtube-transcript` de lay transcript YouTube.
- `normalize-vietnamese` va `transcript-cleaner` de lam sach transcript.
- `semantic-chunking` de chia transcript theo ngu nghia.
- LangChain `ChatOpenAI` de goi Groq qua OpenAI-compatible endpoint.
- LangChain `MemoryVectorStore` va `LocalHashEmbeddings` cho RAG in-memory.

### Frontend

- React 19.
- Vite.
- React Router.
- TanStack React Query.
- Axios.
- Zustand.
- Tailwind CSS 4.
- Lucide React.

### Ha tang va danh gia

- Docker Compose chay PostgreSQL bang image `pgvector/pgvector:pg16`.
- Prisma migrations nam trong `prisma/migrations`.
- Schema Prisma duy nhat nam tai `prisma/schema.prisma`.
- DeepEval harness nam tai `scripts/evaluate-chat-deepeval.py`.
- Npm wrappers ho tro `eval:rag:deepeval`, `eval:summarize:deepeval`, `eval:video:deepeval`.

## 3. Cau truc thu muc

```text
video-sum/
+-- src/
|   +-- app.module.ts
|   +-- main.ts
|   +-- prisma/
|   +-- video/
|   +-- chunks/
|   +-- summaries/
|   +-- quizzes/
|   +-- quiz-questions/
|   +-- chat-sessions/
|   +-- projects/
|   +-- rag/
+-- prisma/
|   +-- schema.prisma
|   +-- migrations/
+-- frontend/
|   +-- src/
|   |   +-- pages/
|   |   +-- services/
|   |   +-- components/
|   |   +-- store/
|   |   +-- types/
|   +-- vite.config.ts
+-- scripts/
|   +-- dev.js
|   +-- evaluate-chat-quality.js
|   +-- evaluate-chat-deepeval.py
|   +-- chat-eval.sample.json
|   +-- video-eval.sample.json
+-- docker-compose.yml
+-- package.json
+-- requirements-deepeval.txt
+-- README.md
+-- mo-ta-du-an.md
```

## 4. Kien truc tong the

Luong hoc chinh:

```text
YouTube URL
  -> POST /videos
  -> extract youtubeId
  -> fetch transcript tu YouTube
  -> clean transcript
  -> luu Video + Transcript vao PostgreSQL
  -> ingest transcript vao RAG in-memory
  -> ensure/generate chunks
  -> generate summary tu chunks
  -> generate quiz tu summary + chunks
  -> chat hoi dap voi chunks/retrieved context
```

Backend duoc chia theo module:

- `video`: quan ly video, lay transcript, clean text va ingest transcript vao RAG.
- `chunks`: chia transcript thanh chunk doc lap, luu chunk vao PostgreSQL.
- `summaries`: tao summary AI-first tu chunk, co fallback extractive/hierarchical.
- `quizzes`: tao mini test tu summary va chunk, uu tien AI, co fallback rule-based.
- `quiz-questions`: cham dap an tung cau hoi.
- `chat-sessions`: tao phien chat, luu message, lay chunk lien quan va goi RAG.
- `projects`: gom nhom video theo project.
- `rag`: ingest text/web content, tao vector store tam thoi va tra loi bang LLM.
- `prisma`: PrismaService va ket noi database.

## 5. Cac tinh nang chinh

### 5.1 Quan ly video

API `POST /videos` nhan URL YouTube. Controller co the tu trich xuat `youtubeId` tu cac dang URL:

- `youtube.com/watch?v=...`
- `youtu.be/...`
- `youtube.com/embed/...`
- `youtube.com/shorts/...`

`VideoService.create()` tao video, lay transcript bang `youtube-transcript`, lam sach text, luu transcript, ingest raw transcript vao RAG va cap nhat trang thai video.

API video:

- `POST /videos`
- `GET /videos`
- `GET /videos/:id`
- `PATCH /videos/:id`
- `DELETE /videos/:id`

Body toi thieu:

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

Co the truyen them `language`, `title`, `durationSec`, `projectId`, hoac `youtubeId` neu can.

### 5.2 Chunking transcript

Module `chunks` tao chunk tu transcript va la lop nguon cho summary, quiz, chat.

Chien luoc chunking:

- `semantic`: dung package `semantic-chunking`.
- `fixed-word-fallback`: chia theo 180 tu neu semantic chunking loi hoac khong tra ve ket qua.

Gia tri mac dinh trong code:

- model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`;
- dtype: `q8`;
- device: `cpu`;
- `maxTokenSize`: 220;
- `similarityThreshold`: 0.45;
- dynamic lower/upper: 0.35 / 0.75;
- lookahead: 3;
- combine threshold: 0.5;
- fallback chunk size: 180 tu.

API chunk:

- `POST /chunks/preview`
- `POST /chunks/from-video/:videoId`
- `GET /chunks?videoId=...`
- `GET /chunks?transcriptId=...`
- `GET /chunks/:id`
- `DELETE /chunks/:id`

### 5.3 Tom tat video

Module `summaries` tao summary dua tren chunks. Neu video chua co chunks, service goi `ChunkService.ensureTranscriptChunks()` de tao truoc.

Luong hien tai la AI-first, fallback extractive:

```text
latest transcript
  -> ensure chunks
  -> fallback draft: hierarchical-extractive-v2
  -> neu co GROQ_API_KEY va SUMMARY_MODE khac fallback:
       direct AI summary neu video ngan
       hoac map -> collapse -> reduce neu video dai
  -> parse strict JSON
  -> upsert Summary theo videoId
```

Output public cua summary van giu on dinh:

- `keyPoints`
- `simplifiedText`
- `mainTopics`
- `modelUsed`
- `promptTokens`
- `completionTokens`

`modelUsed` co the la:

- `groq:<model>:math-summary-direct-v2`
- `groq:<model>:math-summary-mapreduce-v1`
- `hierarchical-extractive-v2`

API summary:

- `GET /summaries?videoId=...`
- `GET /summaries/:id`
- `POST /summaries/from-video/:videoId`
- `DELETE /summaries/:id`

### 5.4 Trac nghiem

Module `quizzes` tao mini test tu summary va chunk cua video. Neu video chua co summary, service tao summary truoc.

Mac dinh moi quiz co 10 cau. Luong tao cau hoi:

```text
summary + source chunks
  -> neu co GROQ_API_KEY: tao cau hoi bang Groq ChatOpenAI
  -> parse JSON questions
  -> gan sourceChunkId neu tim duoc chunk phu hop
  -> neu AI loi/thieu cau: fallback summary-rule-minitest-v2
```

Bang `quiz_questions` luu:

- cau hoi;
- options A/B/C/D;
- dap an dung;
- explanation;
- questionIndex;
- `sourceChunkId` neu co.

API quiz:

- `POST /quizzes/from-video/:videoId`
- `GET /quizzes?videoId=...`
- `GET /quizzes/:id`
- `DELETE /quizzes/:id`

API cham cau hoi:

- `POST /quiz-questions/:id/check-answer`

Ket qua cham dap an tra ve dap an da chon, dap an dung, dung/sai, feedback va explanation.

### 5.5 Chat voi video

Module `chat-sessions` quan ly phien chat theo video hoac project. Khi nguoi dung hoi:

```text
user question
  -> luu user message
  -> ensure chunks tu transcript moi nhat
  -> rank chunks theo keyword/math evidence
  -> lay toi da 4 chunks lam context
  -> RagService.answerQuestion()
  -> luu assistant message + retrievedChunks
```

`POST /chat-messages/ask` tra ve:

- `answer`
- `modelUsed`
- `userMessage`
- `assistantMessage`
- `retrievedChunks`

API chat:

- `POST /chat-sessions`
- `GET /chat-sessions?videoId=...`
- `GET /chat-sessions?projectId=...`
- `GET /chat-sessions/:id`
- `PATCH /chat-sessions/:id`
- `DELETE /chat-sessions/:id`
- `GET /chat-messages?sessionId=...`
- `POST /chat-messages/ask`

Chat can `GROQ_API_KEY`. Neu thieu key hoac provider loi, backend luu assistant message voi thong bao loi da sanitize key.

### 5.6 RAG

Module `rag` gom:

- `IngestService`: ingest transcript text hoac web URLs.
- `LocalHashEmbeddings`: embedding cuc bo bang hash vector 384 chieu.
- `MemoryVectorStore`: vector store trong bo nho tien trinh Node.
- `RagService`: nhan question + optional context chunks, goi Groq qua LangChain `ChatOpenAI`.

Voi chat video, code uu tien chunks da luu trong database lam context. Neu khong truyen context chunks, `RagService` se fallback sang vector store in-memory da ingest truoc do.

Gioi han quan trong: vector store hien khong persistent. Restart backend se mat index in-memory, nhung chunks trong PostgreSQL van con.

### 5.7 Project

Module `projects` cho phep tao project va gan video vao project.

API project:

- `POST /projects`
- `GET /projects`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `POST /projects/:id/videos`
- `GET /projects/:id/videos`
- `DELETE /projects/:id`

`Video.projectId`, `ChatSession.projectId` va `FlashcardSet.projectId` da co trong Prisma schema.

### 5.8 Flashcard

Prisma schema da co cac bang:

- `flashcard_sets`
- `flashcards`
- `flashcard_study_progress`

Tuy nhien checkout hien tai khong co `src/flashcard-sets` controller/service public. Frontend `vite.config.ts` co proxy `/flashcard-sets`, nhung `frontend/src/services/api.ts` chua goi API flashcard. Vi vay flashcard hien nen duoc xem la data model da chuan bi, chua phai tinh nang backend/frontend hoan thien trong code hien tai.

### 5.9 Evaluation

Repo co hai huong danh gia:

- `scripts/evaluate-chat-quality.js`: danh gia chat/RAG bang Node script.
- `scripts/evaluate-chat-deepeval.py`: harness DeepEval cho RAG va summarize.

Script DeepEval ho tro:

- `--mode rag`
- `--mode summarize`
- `--mode all`
- `--model groq:<model>`
- lay `retrievedChunks` lam retrieval context cho RAG;
- lay chunks + summary text lam input cho SummarizationMetric.

Npm scripts lien quan:

- `npm run eval:deepeval`
- `npm run eval:chat:deepeval`
- `npm run eval:rag:deepeval`
- `npm run eval:summarize:deepeval`
- `npm run eval:video:deepeval`

## 6. Database

Database chinh la PostgreSQL. Cac model quan trong:

- `Video`: thong tin video YouTube, status va project optional.
- `Project`: nhom video.
- `Transcript`: raw transcript da lay va lam sach.
- `Chunk`: cac doan transcript da chia, co `chunkIndex`, token count, start/end char.
- `Summary`: tom tat duy nhat theo video.
- `Quiz`: bai trac nghiem cua video.
- `QuizQuestion`: cau hoi trong quiz, co dap an dung va optional source chunk.
- `FlashcardSet`, `Flashcard`, `FlashcardStudyProgress`: cau truc flashcard va tien do hoc.
- `ChatSession`: phien chat theo video/project.
- `ChatMessage`: message user/assistant va `retrievedChunks`.

Quan he du lieu chinh:

```text
Project 1-n Video
Project 1-n ChatSession
Project 1-n FlashcardSet
Video 1-n Transcript
Video 1-n Chunk
Video 1-1 Summary
Video 1-n Quiz
Video 1-n ChatSession
Video 1-n FlashcardSet
Transcript 1-n Chunk
Quiz 1-n QuizQuestion
Chunk 1-n QuizQuestion
Chunk 1-n Flashcard
ChatSession 1-n ChatMessage
FlashcardSet 1-n Flashcard
FlashcardSet 1-n FlashcardStudyProgress
Flashcard 1-n FlashcardStudyProgress
```

## 7. Frontend

Frontend nam trong `frontend`.

Routes hien tai:

- `/`: nhap URL YouTube, xem danh sach video va project.
- `/video/:videoId`: xem thong tin video, summary va cong cu hoc tap.
- `/video/:videoId/chat`: chat voi noi dung video.
- `/video/:videoId/quiz`: tao va lam trac nghiem.

API client nam tai `frontend/src/services/api.ts`. Frontend goi backend qua Vite proxy voi backend mac dinh o `http://127.0.0.1:3000`.

Proxy hien co:

- `/videos`
- `/summaries`
- `/chat-sessions`
- `/chat-messages`
- `/quizzes`
- `/quiz-questions`
- `/flashcard-sets`
- `/projects`
- `/chunks`

## 8. Bien moi truong

Toi thieu cho backend:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/video_sum?schema=public"
```

Cho Groq/LLM:

```env
GROQ_API_KEY="..."
GROQ_MODEL="llama-3.1-8b-instant"
GROQ_BASE_URL="https://api.groq.com/openai/v1"
```

Cho summary AI-first:

```env
SUMMARY_MODE="auto"
SUMMARY_DIRECT_MAX_CHUNKS="8"
SUMMARY_MAP_GROUP_SIZE="4"
SUMMARY_MAX_MAP_GROUPS="10"
SUMMARY_MAP_MAX_TOKENS="1100"
SUMMARY_COLLAPSE_MAX_GROUPS="6"
SUMMARY_COLLAPSE_MAX_TOKENS="900"
SUMMARY_REDUCE_MAX_TOKENS="1400"
SUMMARY_CHUNK_WORD_LIMIT="180"
SUMMARY_RETRY_ATTEMPTS="3"
SUMMARY_RETRY_BASE_DELAY_MS="1200"
```

Cho semantic chunking:

```env
SEMANTIC_CHUNKING_MODEL="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
SEMANTIC_CHUNKING_DTYPE="q8"
SEMANTIC_CHUNKING_DEVICE="cpu"
SEMANTIC_CHUNKING_MODEL_CACHE_DIR="./models/semantic-chunking"
SEMANTIC_CHUNKING_MAX_TOKENS="220"
SEMANTIC_CHUNKING_SIMILARITY_THRESHOLD="0.45"
SEMANTIC_CHUNKING_DYNAMIC_LOWER="0.35"
SEMANTIC_CHUNKING_DYNAMIC_UPPER="0.75"
SEMANTIC_CHUNKING_LOOKAHEAD="3"
SEMANTIC_CHUNKING_COMBINE_THRESHOLD="0.5"
```

Cho DeepEval:

```env
DEEPEVAL_MODEL="groq:llama-3.3-70b-versatile"
DEEPEVAL_MODE="rag"
DEEPEVAL_THRESHOLD="0.7"
DEEPEVAL_JUDGE_MAX_TOKENS="4096"
VIDEO_ID="..."
SUMMARY_ID="..."
```

## 9. Cach chay du an

### 9.1 Cai dependencies

```bash
npm install
npm --prefix frontend install
```

Neu can dung DeepEval:

```bash
.\.venv\Scripts\python.exe -m pip install -r requirements-deepeval.txt
```

### 9.2 Chay database

```bash
docker compose up -d
```

### 9.3 Generate Prisma client va chay migration

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 9.4 Chay backend

```bash
npm run start:dev
```

Backend mac dinh:

```text
http://localhost:3000
```

### 9.5 Chay frontend

```bash
npm --prefix frontend run dev
```

Frontend mac dinh:

```text
http://localhost:5173
```

### 9.6 Chay backend va frontend bang script co san

Repo co `scripts/dev.js` de kill port 3000/5173 roi chay backend va frontend cung luc:

```bash
node scripts/dev.js
```

Luu y: `scripts/dev.js` chua duoc gan vao `package.json`, nen hien tai can goi truc tiep bang `node scripts/dev.js`.

## 10. API flow test nhanh

### Tao video

```bash
curl -X POST http://localhost:3000/videos \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://www.youtube.com/watch?v=VIDEO_ID\"}"
```

Lay `video.id` tu response.

### Tao chunks

```bash
curl -X POST http://localhost:3000/chunks/from-video/VIDEO_UUID
```

### Tao summary

```bash
curl -X POST http://localhost:3000/summaries/from-video/VIDEO_UUID
```

### Tao quiz

```bash
curl -X POST http://localhost:3000/quizzes/from-video/VIDEO_UUID
```

### Kiem tra dap an quiz

```bash
curl -X POST http://localhost:3000/quiz-questions/QUESTION_UUID/check-answer \
  -H "Content-Type: application/json" \
  -d "{\"selectedOption\":\"A\"}"
```

### Tao chat session

```bash
curl -X POST http://localhost:3000/chat-sessions \
  -H "Content-Type: application/json" \
  -d "{\"videoId\":\"VIDEO_UUID\",\"title\":\"New Chat\"}"
```

### Hoi chatbot

```bash
curl -X POST http://localhost:3000/chat-messages/ask \
  -H "Content-Type: application/json" \
  -d "{\"sessionId\":\"SESSION_UUID\",\"content\":\"Noi dung chinh cua video la gi?\"}"
```

### Xem chunks de doi chieu nguon

```bash
curl "http://localhost:3000/chunks?videoId=VIDEO_UUID"
```

## 11. API flow danh gia nhanh

Chay RAG eval voi Groq:

```bash
npm run eval:rag:deepeval -- --video-id VIDEO_UUID --model groq:llama-3.3-70b-versatile
```

Chay summarize eval:

```bash
npm run eval:summarize:deepeval -- --video-id VIDEO_UUID --summary-id SUMMARY_UUID --model groq:llama-3.3-70b-versatile
```

Neu gap rate limit Groq, nen tach `rag` va `summarize` thanh hai lan chay rieng, giam metric hoac giam `DEEPEVAL_JUDGE_MAX_TOKENS`.

## 12. Diem manh hien tai

- Backend module hoa ro theo resource: video, chunks, summaries, quizzes, chat, project, rag.
- Prisma schema tap trung mot noi tai `prisma/schema.prisma`.
- Chunking va summary duoc tach rieng, de test tung buoc.
- Summary hien co AI-first path, strict JSON parsing, retry/backoff va fallback extractive.
- Quiz co AI-first path tu summary + chunks, fallback rule-based va luu `sourceChunkId`.
- Chat tra ve `retrievedChunks`, huu ich cho debugging va evaluation.
- Frontend da co luong hoc co ban: nhap video, xem summary, chat, lam quiz.
- Repo co DeepEval harness de do chat RAG va summarize bang run that.

## 13. Gioi han hien tai va huong phat trien

### Gioi han hien tai

- README goc van la template NestJS, chua phan anh dung du an.
- RAG vector store van la in-memory, restart backend se mat index tam thoi.
- Chat, AI summary va AI quiz can `GROQ_API_KEY`.
- Flashcard moi co schema, chua co public controller/service/frontend flow trong checkout hien tai.
- Prompt quiz trong code dang co dau hieu loi encoding o mot so chuoi tieng Viet, can chuan hoa UTF-8.
- DeepEval voi Groq co the gap rate limit neu chay `--mode all` hoac prompt qua dai.
- Chua thay test tu dong cho cac service quan trong.

### Huong phat trien tiep theo

- Chuyen retrieval sang vector database persistent neu can on dinh sau restart.
- Hoan thien API/UI flashcard neu muon dung schema da co.
- Chuan hoa lai cac chuoi tieng Viet bi loi encoding trong quiz prompt/fallback.
- Them citation ro hon theo `chunkIndex` cho summary, quiz va chat.
- Gan `scripts/dev.js` vao `package.json` de chay mot lenh.
- Viet README moi thay template NestJS.
- Them unit/integration tests cho video, chunks, summaries, quizzes va chat.
- Mo rong eval set de co benchmark on dinh truoc/sau moi lan sua prompt.

## 14. Tom tat ngan gon

Video Sum la he thong hoc tap tu video YouTube. Backend lay transcript, chia chunk, tao summary, tao quiz va chat dua tren noi dung video. Frontend cung cap giao dien nhap video, xem tom tat, hoi dap va lam trac nghiem. Trang thai hien tai la MVP co day du luong `video -> transcript -> chunks -> summary -> quiz/chat`, co Groq AI path cho summary/quiz/chat, co fallback khi AI loi, va co DeepEval harness de do chat RAG/summarize bang du lieu that.
