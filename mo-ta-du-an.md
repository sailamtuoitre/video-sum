# Mo ta du an Video Sum

## 1. Tong quan

Video Sum la ung dung ho tro hoc tap tu video YouTube. Nguoi dung nhap URL video, he thong lay transcript, lam sach noi dung, chia transcript thanh cac doan nho, tao tom tat, tao bai trac nghiem va cho phep hoi dap voi noi dung video.

Du an gom hai phan chinh:

- Backend: NestJS, TypeScript, Prisma va PostgreSQL.
- Frontend: React, Vite, React Query, Zustand, Tailwind CSS va Axios.

Muc tieu cua du an la bien mot video hoc tap thanh mot bo tai lieu hoc nhanh, gom:

- transcript da xu ly;
- cac chunk noi dung de truy van va tao tai lieu hoc;
- tom tat video;
- cau hoi trac nghiem kem cham dap an;
- chat voi video dua tren transcript;
- quan ly video theo project.

## 2. Cong nghe su dung

### Backend

- NestJS 11 lam framework API.
- TypeScript lam ngon ngu chinh.
- Prisma 6.19.3 lam ORM.
- PostgreSQL lam database chinh.
- `youtube-transcript` de lay transcript YouTube.
- `normalize-vietnamese` de ho tro xu ly van ban tieng Viet.
- `semantic-chunking` de chia transcript theo ngu nghia.
- LangChain de tao in-memory vector store va QA chain.
- Groq/OpenAI-compatible API cho tinh nang hoi dap bang LLM.

### Frontend

- React 19.
- Vite.
- React Router.
- TanStack React Query.
- Axios.
- Zustand.
- Tailwind CSS 4.
- Lucide React.

### Ha tang phat trien

- Docker Compose chay PostgreSQL bang image `pgvector/pgvector:pg16`.
- Prisma migrations nam trong thu muc `prisma/migrations`.
- Schema Prisma chinh thuc nam tai `prisma/schema.prisma`.

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
|   |   +-- types/
|   +-- vite.config.ts
+-- scripts/
|   +-- dev.js
+-- docker-compose.yml
+-- package.json
+-- README.md
```

## 4. Kien truc tong the

Luon xu ly chinh cua he thong:

```text
YouTube URL
  -> POST /videos
  -> lay youtubeId va title
  -> fetch transcript tu YouTube
  -> clean transcript
  -> luu Video + Transcript vao PostgreSQL
  -> ingest transcript vao in-memory vector store
  -> POST /chunks/from-video/:videoId
  -> POST /summaries/from-video/:videoId
  -> POST /quizzes/from-video/:videoId
  -> POST /chat-messages/ask
```

Backend duoc chia theo module rieng:

- `video`: quan ly video, lay transcript va ingest vao RAG.
- `chunks`: chia transcript thanh chunk doc lap.
- `summaries`: tao tom tat tu chunk.
- `quizzes`: tao bai trac nghiem tu summary va chunk.
- `quiz-questions`: cham dap an tung cau hoi.
- `chat-sessions`: tao phien chat va hoi dap theo video/project.
- `projects`: gom nhom video theo project.
- `rag`: ingest noi dung, tao vector store tam thoi va hoi dap bang LLM.
- `prisma`: PrismaService va ket noi database.

## 5. Cac tinh nang chinh

### 5.1 Quan ly video

API `POST /videos` nhan URL YouTube. Controller co the tu trich xuat `youtubeId` tu cac dang URL:

- `youtube.com/watch?v=...`
- `youtu.be/...`
- `youtube.com/embed/...`
- `youtube.com/shorts/...`

Service tao ban ghi video, lay transcript bang `youtube-transcript`, lam sach text bang `transcript-cleaner`, luu transcript va ingest noi dung vao RAG.

Cac API video hien co:

- `POST /videos`
- `GET /videos`
- `GET /videos/:id`
- `PATCH /videos/:id`
- `DELETE /videos/:id`

### 5.2 Chunking transcript

Module `chunks` chiu trach nhiem chia transcript thanh cac doan nho de dung cho summary, quiz va chat.

Co hai chien luoc:

- `semantic`: dung package `semantic-chunking`.
- `fixed-word-fallback`: chia theo so tu neu semantic chunking loi hoac khong tra ve ket qua.

Tham so mac dinh dang duoc dung trong code:

- model: `Xenova/paraphrase-multilingual-MiniLM-L12-v2`;
- `maxTokenSize`: 220;
- `similarityThreshold`: 0.45;
- fallback chunk size: 180 tu.

Cac API chunk:

- `POST /chunks/preview`
- `POST /chunks/from-video/:videoId`
- `GET /chunks`
- `GET /chunks/:id`
- `DELETE /chunks/:id`

### 5.3 Tom tat video

Module `summaries` tao summary dua tren chunk da co. Neu video chua co chunk, service se goi `ChunkService.ensureTranscriptChunks()` de tao chunk truoc.

Hien tai summary la dang extractive/hierarchical, khong phai free-form LLM summary. Luong tom tat:

```text
chunks
  -> chunk digest
  -> section summaries
  -> key points
  -> simplified text
  -> main topics
```

Ket qua luu trong bang `summaries`, gom:

- `keyPoints`
- `simplifiedText`
- `mainTopics`
- `modelUsed`
- token thong ke tham khao

Cac API summary:

- `GET /summaries?videoId=...`
- `GET /summaries/:id`
- `POST /summaries/from-video/:videoId`
- `DELETE /summaries/:id`

### 5.4 Trac nghiem

Module `quizzes` tao bai mini test tu summary va chunk cua video. Neu video chua co summary, service se tao summary truoc.

Mac dinh moi bai quiz co 10 cau hoi. Cau hoi duoc tao theo rule-based generator tu:

- chunk transcript;
- key points;
- main topics;
- simplified summary.

Bang `quiz_questions` luu dap an dung, cac lua chon A/B/C/D, giai thich va chunk nguon neu co.

Cac API quiz:

- `POST /quizzes/from-video/:videoId`
- `GET /quizzes?videoId=...`
- `GET /quizzes/:id`
- `DELETE /quizzes/:id`

API cham cau hoi:

- `POST /quiz-questions/:id/check-answer`

Ket qua cham dap an tra ve:

- dap an nguoi dung chon;
- dap an dung;
- dung/sai;
- feedback;
- explanation.

### 5.5 Chat voi video

Module `chat-sessions` quan ly phien chat theo video hoac project. Khi nguoi dung hoi, backend luu message cua user, lay chunk lien quan cua video, ingest chunk vao RAG, sau do goi `RagService.answerQuestion()`.

Neu co chunk cua video, response se tra them `retrievedChunks` de frontend hien thi nguon tham khao.

Cac API chat:

- `POST /chat-sessions`
- `GET /chat-sessions?videoId=...`
- `GET /chat-sessions/:id`
- `PATCH /chat-sessions/:id`
- `DELETE /chat-sessions/:id`
- `GET /chat-messages?sessionId=...`
- `POST /chat-messages/ask`

Chat can bien moi truong `GROQ_API_KEY` de goi LLM. Neu thieu key, backend se tra ve thong bao loi da duoc sanitize.

### 5.6 RAG

Module `rag` gom:

- `IngestService`: tao vector store trong memory tu transcript/web content.
- `LocalHashEmbeddings`: embedding cuc bo bang hash vector 384 chieu.
- `RagService`: truy van vector store va goi LLM bang LangChain `loadQAChain`.

RAG hien tai luu vector store trong bo nho tien trinh backend, chua phai vector database persistent trong PostgreSQL.

### 5.7 Project

Module `projects` cho phep tao project va gan video vao project.

Cac API project:

- `POST /projects`
- `GET /projects`
- `GET /projects/:id`
- `PATCH /projects/:id`
- `POST /projects/:id/videos`
- `GET /projects/:id/videos`
- `DELETE /projects/:id`

### 5.8 Flashcard

Schema Prisma hien co cac bang:

- `flashcard_sets`
- `flashcards`
- `flashcard_study_progress`

Tuy nhien trong code hien tai khong thay controller/service public cho flashcard set. Frontend `vite.config.ts` co proxy `/flashcard-sets`, nhung frontend service hien tai chua goi API flashcard. Vi vay co the xem flashcard la phan data model da duoc chuan bi, con API/UI hien tai chua hoan thien trong checkout nay.

## 6. Database

Database chinh la PostgreSQL. Cac model quan trong:

- `Video`: thong tin video YouTube.
- `Project`: nhom video.
- `Transcript`: transcript da lay tu video.
- `Chunk`: cac doan transcript da chia.
- `Summary`: tom tat cua video.
- `Quiz`: bai trac nghiem.
- `QuizQuestion`: tung cau hoi trong quiz.
- `FlashcardSet`, `Flashcard`, `FlashcardStudyProgress`: cau truc flashcard.
- `ChatSession`: phien chat.
- `ChatMessage`: message user/assistant va retrieved context.

Quan he du lieu chinh:

```text
Project 1-n Video
Video 1-n Transcript
Transcript 1-n Chunk
Video 1-1 Summary
Video 1-n Quiz
Quiz 1-n QuizQuestion
Video 1-n ChatSession
ChatSession 1-n ChatMessage
Video/Project 1-n FlashcardSet
FlashcardSet 1-n Flashcard
Flashcard 1-n FlashcardStudyProgress
```

## 7. Frontend

Frontend nam trong thu muc `frontend`.

Cac route chinh:

- `/`: nhap URL YouTube va xem danh sach video.
- `/video/:videoId`: xem thong tin video, summary va cong cu hoc tap.
- `/video/:videoId/chat`: chat voi noi dung video.
- `/video/:videoId/quiz`: tao va lam trac nghiem.

File API client nam tai `frontend/src/services/api.ts`. Frontend goi backend qua Vite proxy, voi backend mac dinh o `http://127.0.0.1:3000`.

## 8. Bien moi truong can co

Backend can toi thieu:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/video_sum?schema=public"
```

Neu dung tinh nang chat voi LLM:

```env
GROQ_API_KEY="..."
GROQ_MODEL="llama-3.1-8b-instant"
GROQ_BASE_URL="https://api.groq.com/openai/v1"
```

Semantic chunking co the tuy bien bang:

```env
SEMANTIC_CHUNKING_MODEL="Xenova/paraphrase-multilingual-MiniLM-L12-v2"
SEMANTIC_CHUNKING_DTYPE="q8"
SEMANTIC_CHUNKING_DEVICE="cpu"
SEMANTIC_CHUNKING_MODEL_CACHE_DIR="./models/semantic-chunking"
SEMANTIC_CHUNKING_MAX_TOKENS="220"
SEMANTIC_CHUNKING_SIMILARITY_THRESHOLD="0.45"
```

## 9. Cach chay du an

### 9.1 Cai dependencies

```bash
npm install
npm --prefix frontend install
```

### 9.2 Chay database

```bash
docker compose up -d
```

### 9.3 Chay migration va generate Prisma client

```bash
npm run prisma:generate
npm run prisma:migrate
```

### 9.4 Chay backend

```bash
npm run start:dev
```

Backend mac dinh lang nghe tai:

```text
http://localhost:3000
```

### 9.5 Chay frontend

```bash
npm --prefix frontend run dev
```

Frontend mac dinh tai:

```text
http://localhost:5173
```

### 9.6 Chay frontend va backend bang script co san

Repo co file `scripts/dev.js` de kill port 3000/5173 roi chay backend va frontend cung luc:

```bash
node scripts/dev.js
```

Luu y: file nay chua duoc gan vao script `package.json`, nen hien tai can goi truc tiep bang `node scripts/dev.js`.

## 10. API flow de test nhanh

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

## 11. Diem manh hien tai

- Backend da co module hoa ro rang theo tai nguyen: video, chunk, summary, quiz, chat, project.
- Chunking va summary duoc tach rieng, giup test tung buoc doc lap.
- Summary dua tren chunk nen giam rui ro xu ly transcript qua dai.
- Quiz co cham dap an va feedback, khong chi tao cau hoi.
- Frontend da co luong hoc co ban: nhap video, xem summary, chat, lam quiz.
- Database schema da bao phu nhieu doi tuong hoc tap: video, transcript, chunk, summary, quiz, flashcard, chat.

## 12. Gioi han hien tai va huong phat trien

### Gioi han hien tai

- README goc van la template NestJS, chua phan anh dung du an.
- RAG vector store hien dang nam trong memory cua process, restart backend se mat index.
- Chat can `GROQ_API_KEY`, neu khong co key thi khong tra loi bang LLM duoc.
- Summary hien la extractive/rule-based, chua phai LLM summary tu nhien.
- Quiz hien la rule-based generator, chua dung LLM trong code hien tai.
- Schema co flashcard nhung chua thay API/UI flashcard hoan chinh trong checkout hien tai.
- Mot so text tieng Viet trong frontend/service co dau hieu loi encoding, can chuan hoa lai UTF-8.

### Huong phat trien tiep theo

- Chuyen RAG sang vector database persistent neu can truy van on dinh sau restart.
- Hoan thien API/UI flashcard theo schema da co.
- Cai thien quiz bang LLM co prompt theo mon Toan, gom dai so, hinh hoc, xac suat.
- Them citation ro hon cho summary, quiz va chat theo `chunkIndex`.
- Bo sung script `dev` vao `package.json` de chay mot lenh cho ca frontend va backend.
- Viet README moi thay cho template NestJS.
- Them test cho controller/service quan trong: video, chunks, summaries, quizzes, chat.

## 13. Tom tat ngan gon

Video Sum la mot he thong hoc tap tu video YouTube. Backend lay transcript, chia chunk, tao summary, tao quiz va ho tro chat dua tren noi dung video. Frontend cung cap giao dien nhap video, xem tom tat, chat va lam trac nghiem. Du an dang o muc MVP kha day du cho luong hoc video -> transcript -> chunk -> summary -> quiz/chat, va co nen tang database de mo rong sang flashcard, project-based learning va retrieval chinh xac hon.
