# API Design
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  
**Base URL:** `http://localhost:4000/api`  
**Format:** JSON  

---

## Table of Contents

1. [Conventions](#1-conventions)
2. [Video Endpoints](#2-video-endpoints)
3. [Summary Endpoints](#3-summary-endpoints)
4. [Chat Endpoints](#4-chat-endpoints)
5. [Quiz Endpoints](#5-quiz-endpoints)
6. [Flashcard Endpoints](#6-flashcard-endpoints)
7. [Error Handling](#7-error-handling)
8. [Type Definitions](#8-type-definitions)

---

## 1. Conventions

### Request Format

- All request bodies: `Content-Type: application/json`
- URL parameters: `:paramName` (UUID strings)
- Query parameters for pagination: `?page=1&limit=20`

### Response Format

**Success:**
```json
{
  "data": { ... },
  "message": "Success"
}
```

**Error:**
```json
{
  "statusCode": 400,
  "message": "Invalid YouTube URL",
  "timestamp": "2026-05-03T00:00:00.000Z"
}
```

### Status Codes

| Code | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `202` | Accepted (async processing started) |
| `400` | Bad Request |
| `404` | Not Found |
| `409` | Conflict (duplicate) |
| `422` | Unprocessable Entity |
| `500` | Internal Server Error |

---

## 2. Video Endpoints

### `POST /videos`

Submit a YouTube URL for processing.

**Request Body:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Validation:**
- `url` must match YouTube URL pattern
- `url` is required

**Response `202 Accepted`:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "youtubeId": "dQw4w9WgXcQ",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": null,
  "status": "pending",
  "createdAt": "2026-05-03T00:00:00.000Z"
}
```

**Response `409 Conflict`** (video already exists):
```json
{
  "statusCode": 409,
  "message": "Video already processed",
  "existingId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### `GET /videos`

List all processed videos.

**Query Parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page |
| `status` | string | — | Filter by status |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "id": "550e8400-...",
      "youtubeId": "dQw4w9WgXcQ",
      "title": "Introduction to RAG",
      "status": "completed",
      "language": "vi",
      "durationSec": 3600,
      "createdAt": "2026-05-03T00:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

### `GET /videos/:id`

Get a single video by ID.

**Response `200 OK`:**
```json
{
  "id": "550e8400-...",
  "youtubeId": "dQw4w9WgXcQ",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "title": "Introduction to RAG",
  "status": "completed",
  "language": "vi",
  "durationSec": 3600,
  "errorMessage": null,
  "createdAt": "2026-05-03T00:00:00.000Z",
  "updatedAt": "2026-05-03T00:05:00.000Z"
}
```

**Response `404 Not Found`:**
```json
{
  "statusCode": 404,
  "message": "Video not found"
}
```

---

### `DELETE /videos/:id`

Delete a video and all associated data (cascades to DB + Qdrant).

**Response `200 OK`:**
```json
{
  "message": "Video deleted successfully"
}
```

---

### `POST /videos/:id/reprocess`

Trigger reprocessing for a failed video.

**Response `202 Accepted`:**
```json
{
  "id": "550e8400-...",
  "status": "pending",
  "message": "Reprocessing started"
}
```

---

## 3. Summary Endpoints

### `GET /videos/:videoId/summary`

Get the AI-generated summary for a video.

**Response `200 OK`:**
```json
{
  "id": "abc-123",
  "videoId": "550e8400-...",
  "keyPoints": [
    "RAG kết hợp retrieval với LLM generation",
    "Chunking ảnh hưởng trực tiếp đến chất lượng retrieval",
    "Vector search sử dụng cosine similarity"
  ],
  "simplifiedText": "RAG là kỹ thuật giúp LLM trả lời chính xác hơn bằng cách...",
  "mainTopics": ["RAG", "Vector Database", "Embedding", "LLM"],
  "modelUsed": "gpt-4o-mini",
  "createdAt": "2026-05-03T00:05:00.000Z"
}
```

**Response `404 Not Found`** (video not yet completed):
```json
{
  "statusCode": 404,
  "message": "Summary not available yet. Video status: processing"
}
```

---

## 4. Chat Endpoints

### `POST /chat/sessions`

Create a new chat session for a video.

**Request Body:**
```json
{
  "videoId": "550e8400-..."
}
```

**Response `201 Created`:**
```json
{
  "id": "session-uuid",
  "videoId": "550e8400-...",
  "title": "New Chat",
  "createdAt": "2026-05-03T00:10:00.000Z"
}
```

---

### `GET /chat/sessions`

List all chat sessions (optionally filter by videoId).

**Query Parameters:**

| Param | Type | Description |
|---|---|---|
| `videoId` | UUID | Filter sessions by video |

**Response `200 OK`:**
```json
[
  {
    "id": "session-uuid",
    "videoId": "550e8400-...",
    "title": "New Chat",
    "createdAt": "2026-05-03T00:10:00.000Z"
  }
]
```

---

### `GET /chat/sessions/:sessionId/messages`

Get all messages in a session.

**Response `200 OK`:**
```json
[
  {
    "id": "msg-uuid-1",
    "sessionId": "session-uuid",
    "role": "user",
    "content": "RAG là gì?",
    "retrievedChunks": null,
    "createdAt": "2026-05-03T00:10:30.000Z"
  },
  {
    "id": "msg-uuid-2",
    "sessionId": "session-uuid",
    "role": "assistant",
    "content": "RAG (Retrieval-Augmented Generation) là kỹ thuật...",
    "retrievedChunks": ["chunk-id-1", "chunk-id-2"],
    "promptTokens": 450,
    "completionTokens": 210,
    "createdAt": "2026-05-03T00:10:32.000Z"
  }
]
```

---

### `POST /chat/sessions/:sessionId/messages`

Send a message and receive an AI response.

**Request Body:**
```json
{
  "content": "RAG là gì và tại sao nó quan trọng?"
}
```

**Response `201 Created`:**
```json
{
  "id": "msg-uuid-2",
  "sessionId": "session-uuid",
  "role": "assistant",
  "content": "RAG (Retrieval-Augmented Generation) là kỹ thuật kết hợp giữa tìm kiếm thông tin và sinh văn bản...",
  "retrievedChunks": [
    {
      "chunkId": "chunk-id-1",
      "content": "RAG là phương pháp...",
      "score": 0.923
    },
    {
      "chunkId": "chunk-id-2",
      "content": "Trong pipeline RAG...",
      "score": 0.891
    }
  ],
  "promptTokens": 450,
  "completionTokens": 210,
  "createdAt": "2026-05-03T00:10:32.000Z"
}
```

**Response when context not found:**
```json
{
  "role": "assistant",
  "content": "Thông tin này không có trong video.",
  "retrievedChunks": []
}
```

---

### `DELETE /chat/sessions/:sessionId`

Delete a chat session and all its messages.

**Response `200 OK`:**
```json
{
  "message": "Session deleted"
}
```

---

## 5. Quiz Endpoints

### `POST /videos/:videoId/quiz`

Generate a quiz for a video. Idempotent — returns existing quiz if already generated.

**Request Body (optional):**
```json
{
  "numQuestions": 10
}
```

**Response `201 Created`:**
```json
{
  "id": "quiz-uuid",
  "videoId": "550e8400-...",
  "title": "Quiz: Introduction to RAG",
  "totalQuestions": 10,
  "questions": [
    {
      "id": "q-uuid-1",
      "questionText": "RAG viết tắt của từ gì?",
      "options": {
        "A": "Retrieval-Augmented Generation",
        "B": "Rapid AI Generation",
        "C": "Recursive Auto-regressive Grammar",
        "D": "Ranked Answer Generation"
      },
      "correctOption": "A",
      "explanation": "RAG là viết tắt của Retrieval-Augmented Generation, kỹ thuật kết hợp retrieval và generation.",
      "questionIndex": 0
    }
  ],
  "createdAt": "2026-05-03T00:15:00.000Z"
}
```

---

### `GET /videos/:videoId/quiz`

Get the existing quiz for a video.

**Response `200 OK`:** Same structure as POST response above.

**Response `404 Not Found`:**
```json
{
  "statusCode": 404,
  "message": "Quiz not generated yet"
}
```

---

### `DELETE /videos/:videoId/quiz`

Delete the quiz (allows regeneration).

**Response `200 OK`:**
```json
{
  "message": "Quiz deleted"
}
```

---

## 6. Flashcard Endpoints

### `POST /flashcard-sets/from-video/:videoId`

Generate a flashcard set for a video. Idempotent.

**Request Body (optional):**
```json
{
  "numCards": 15
}
```

**Response `201 Created`:**
```json
{
  "id": "set-uuid",
  "videoId": "550e8400-...",
  "title": "Flashcards: Introduction to RAG",
  "totalCards": 15,
  "cards": [
    {
      "id": "card-uuid-1",
      "front": "RAG là gì?",
      "back": "Retrieval-Augmented Generation — kỹ thuật kết hợp tìm kiếm thông tin từ knowledge base với khả năng sinh văn bản của LLM để tạo ra câu trả lời chính xác và có căn cứ.",
      "cardIndex": 0
    },
    {
      "id": "card-uuid-2",
      "front": "Chunking là gì?",
      "back": "Quá trình chia văn bản thành các đoạn nhỏ (chunks) để tối ưu hóa embedding và retrieval. Chunk size thường từ 300-700 tokens với overlap 50-100 tokens.",
      "cardIndex": 1
    }
  ],
  "createdAt": "2026-05-03T00:20:00.000Z"
}
```

---

### `POST /flashcard-sets/from-project/:projectId`

Generate a flashcard set for a project.

---

### `GET /flashcard-sets/:id/study`

Get the study state for a flashcard set.

---

### `POST /flashcard-sets/:id/study/review`

Mark a flashcard as `known` or `unknown` and return the updated study state.

---

### `GET /flashcard-sets/:id`

Get the existing flashcard set.

**Response `200 OK`:** Same structure as the generate response above, including `flashcards`.

**Response `404 Not Found`:**
```json
{
  "statusCode": 404,
  "message": "Flashcards not generated yet"
}
```

---

### `POST /flashcard-sets/:id/study/reset`

Reset study progress for a flashcard set.

**Response `200 OK`:**
```json
{
  "message": "Study progress reset"
}
```

---

## 7. Error Handling

### Validation Errors (400)

```json
{
  "statusCode": 400,
  "message": ["url must be a valid YouTube URL"],
  "error": "Bad Request"
}
```

### Not Found (404)

```json
{
  "statusCode": 404,
  "message": "Video not found",
  "timestamp": "2026-05-03T00:00:00.000Z"
}
```

### LLM Rate Limit (429)

```json
{
  "statusCode": 429,
  "message": "LLM API rate limit exceeded. Please retry in 60 seconds.",
  "retryAfter": 60
}
```

### Processing Failed (422)

```json
{
  "statusCode": 422,
  "message": "Transcript extraction failed: Video has no available captions and Whisper is not configured",
  "videoId": "550e8400-..."
}
```

---

## 8. Type Definitions

### `VideoStatus`
```ts
type VideoStatus = 'pending' | 'processing' | 'completed' | 'failed';
```

### `MessageRole`
```ts
type MessageRole = 'user' | 'assistant';
```

### `Video`
```ts
interface Video {
  id: string;
  youtubeId: string;
  url: string;
  title: string | null;
  status: VideoStatus;
  language: string;
  durationSec: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}
```

### `Summary`
```ts
interface Summary {
  id: string;
  videoId: string;
  keyPoints: string[];
  simplifiedText: string;
  mainTopics: string[];
  modelUsed: string;
  createdAt: string;
}
```

### `ChatMessage`
```ts
interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  retrievedChunks: RetrievedChunk[] | null;
  promptTokens: number | null;
  completionTokens: number | null;
  createdAt: string;
}

interface RetrievedChunk {
  chunkId: string;
  content: string;
  score: number;
}
```

### `Quiz`
```ts
interface Quiz {
  id: string;
  videoId: string;
  title: string;
  totalQuestions: number;
  questions: QuizQuestion[];
  createdAt: string;
}

interface QuizQuestion {
  id: string;
  questionText: string;
  options: { A: string; B: string; C: string; D: string };
  correctOption: 'A' | 'B' | 'C' | 'D';
  explanation: string;
  questionIndex: number;
}
```

### `FlashcardSet`
```ts
interface FlashcardSet {
  id: string;
  videoId: string;
  title: string;
  totalCards: number;
  cards: Flashcard[];
  createdAt: string;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  cardIndex: number;
}
```
