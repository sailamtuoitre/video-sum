# Test Plan: All API Modules

## What We're Testing

9 modules with ~50 endpoints total. The goal is verifying every endpoint responds correctly — CRUD operations, validation, special endpoints (RAG ask, chunking, etc.).

## Prerequisites

- Docker PostgreSQL running (`docker compose up -d`)
- `.env` configured with `DATABASE_URL` and `GROQ_API_KEY`
- Prisma migrations applied (`npx prisma migrate dev`)

## Test Infrastructure

### 1. Create `src/test/setup.ts` — Shared Test Fixtures

Create a shared test module that provides:
- A `TestApp` factory using `@nestjs/testing` + `supertest`
- Database seeding helpers (create video, project, session, etc.)
- Cleanup helpers (cascade-delete test data by removing root entities)
- Mock for Groq API calls (all AI-dependent endpoints will use mocks to avoid API costs)

### 2. File Structure

```
src/
├── test/
│   ├── setup.ts                    # TestApp factory, seed helpers, mocks
│   ├── video.e2e-spec.ts           # 5 endpoints
│   ├── project.e2e-spec.ts         # 7 endpoints
│   ├── chunk.e2e-spec.ts           # 7 endpoints
│   ├── summary.e2e-spec.ts         # 6 endpoints
│   ├── quiz.e2e-spec.ts            # 6 endpoints
│   ├── quiz-question.e2e-spec.ts   # 6 endpoints
│   ├── flashcard-set.e2e-spec.ts   # 7 endpoints
│   ├── chat-session.e2e-spec.ts    # 5 endpoints
│   └── chat-message.e2e-spec.ts    # 8 endpoints
```

## Per-Module Test Plan

### 1. Videos (`/videos`) — 5 endpoints
- **POST** `/videos` — create with valid data → 201
- **POST** `/videos` — create with invalid youtubeId/url → 400
- **GET** `/videos` — list all → 200 + array
- **GET** `/videos/:id` — get one → 200 + video object
- **GET** `/videos/:id` — non-existent → 404
- **PATCH** `/videos/:id` — update title → 200
- **DELETE** `/videos/:id` — delete → 200
- **DELETE** `/videos/:id` — delete already deleted → 404

### 2. Projects (`/projects`) — 7 endpoints
- **POST** `/projects` — create with name → 201
- **POST** `/projects` — create with videoIds → 201 (videos linked)
- **GET** `/projects` — list all → 200
- **GET** `/projects/:id` — get with videos relation → 200
- **PATCH** `/projects/:id` — update → 200
- **POST** `/projects/:id/videos` — add videos → 200
- **GET** `/projects/:id/videos` — list project videos → 200
- **DELETE** `/projects/:id` — delete → 200

### 3. Chunks (`/chunks`) — 7 endpoints
Requires: existing video + transcript
- **POST** `/chunks` — create with valid data → 201
- **POST** `/chunks/preview` — preview with raw text → 200
- **POST** `/chunks/from-video/:videoId` — preview from video → 200
- **GET** `/chunks` — list (unfiltered) → 200
- **GET** `/chunks?videoId=X` — list filtered → 200
- **GET** `/chunks/:id` — get one → 200
- **PATCH** `/chunks/:id` — update content → 200
- **DELETE** `/chunks/:id` — delete → 200

### 4. Summaries (`/summaries`) — 6 endpoints
Requires: existing video with chunks
- **POST** `/summaries` — create manually → 201
- **POST** `/summaries` — invalid (missing keyPoints) → 400
- **POST** `/summaries/from-video/:videoId` — auto-generate → 201
- **GET** `/summaries` — list → 200
- **GET** `/summaries/:id` — get one → 200
- **PATCH** `/summaries/:id` — update → 200
- **DELETE** `/summaries/:id` — delete → 200

### 5. Quizzes (`/quizzes`) — 6 endpoints
Requires: existing video
- **POST** `/quizzes` — create → 201
- **POST** `/quizzes/from-video/:videoId` — auto-generate (mocked Groq) → 201
- **GET** `/quizzes` — list → 200
- **GET** `/quizzes?videoId=X` — list filtered → 200
- **GET** `/quizzes/:id` — get one with questions → 200
- **PATCH** `/quizzes/:id` — update title → 200
- **DELETE** `/quizzes/:id` — delete (cascades questions) → 200

### 6. Quiz Questions (`/quiz-questions`) — 6 endpoints
Requires: existing quiz
- **POST** `/quiz-questions` — create with options JSON → 201
- **POST** `/quiz-questions/:id/check-answer` — check correct answer → 200
- **POST** `/quiz-questions/:id/check-answer` — check wrong answer → 200
- **GET** `/quiz-questions` — list → 200
- **GET** `/quiz-questions/:id` — get one → 200
- **PATCH** `/quiz-questions/:id` — update → 200
- **DELETE** `/quiz-questions/:id` — delete → 200

### 7. Flashcard Sets (`/flashcard-sets`) — 7 endpoints
Requires: existing video with chunks
- **POST** `/flashcard-sets/from-video/:videoId` — generate (mocked Groq) → 201
- **POST** `/flashcard-sets/from-project/:projectId` — generate → 201
- **GET** `/flashcard-sets` — list → 200
- **GET** `/flashcard-sets/:id` — get one with flashcards → 200
- **GET** `/flashcard-sets/:id/study` — get study state → 200
- **POST** `/flashcard-sets/:id/study/review` — review card → 200
- **POST** `/flashcard-sets/:id/study/reset` — reset study → 200

### 8. Chat Sessions (`/chat-sessions`) — 5 endpoints
- **POST** `/chat-sessions` — create (video-scoped) → 201
- **POST** `/chat-sessions` — create (project-scoped) → 201
- **GET** `/chat-sessions` — list all → 200
- **GET** `/chat-sessions?videoId=X` — list filtered → 200
- **GET** `/chat-sessions/:id` — get one with messages → 200
- **PATCH** `/chat-sessions/:id` — update → 200
- **DELETE** `/chat-sessions/:id` — delete (cascades messages) → 200

### 9. Chat Messages (`/chat-messages`) — 8 endpoints
Requires: existing chat session
- **POST** `/chat-messages` — create user message → 201
- **POST** `/chat-messages/ask` — RAG ask (mocked Groq) → 201
- **POST** `/chat-messages/ask` — invalid (missing sessionId) → 400
- **GET** `/chat-messages/memory-embeddings` — list embeddings → 200
- **POST** `/chat-messages/memory-embeddings/rebuild` — rebuild → 200
- **GET** `/chat-messages` — list → 200
- **GET** `/chat-messages?sessionId=X` — list filtered → 200
- **GET** `/chat-messages/:id` — get one → 200
- **PATCH** `/chat-messages/:id` — update → 200
- **DELETE** `/chat-messages/:id` — delete → 200

## Mock Strategy

All AI/LLM-dependent endpoints will use Jest mocks on their services:
- `QuizService.createFromVideo` → return fake quiz with 3 questions
- `FlashcardSetService.createFromVideo/createFromProject` → return fake flashcard set
- `ChatMessageService.ask` → return fake RAG answer with citations
- `SummaryService.createFromVideo` → return fake summary
- `ChunkService.previewTranscriptChunks` → return fake chunks

This avoids: Groq API costs, external network calls, yt-dlp dependency, ONNX model loading.

## Verification

Run all tests with:
```bash
npm test
# or with coverage:
npm run test:cov
```

Expected: all tests pass with 0 failures. Coverage report shows every controller endpoint is hit at least once.
