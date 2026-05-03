# System Architecture
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Component Breakdown](#2-component-breakdown)
3. [Frontend Architecture](#3-frontend-architecture)
4. [Backend Architecture](#4-backend-architecture)
5. [AI Pipeline Architecture](#5-ai-pipeline-architecture)
6. [Data Flow (End-to-End)](#6-data-flow-end-to-end)
7. [Scalability Design](#7-scalability-design)
8. [Technology Choices Justification](#8-technology-choices-justification)

---

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER BROWSER                             │
│                    React.js SPA (port 3000)                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP / REST
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    NestJS API Server (port 4000)                │
│                                                                  │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────────┐  │
│  │  Video     │  │ Transcript │  │      RAG Engine           │  │
│  │  Module    │  │  Module    │  │  (Chunk+Embed+Retrieve)   │  │
│  └────────────┘  └────────────┘  └──────────────────────────┘  │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────────┐  │
│  │  Summary   │  │   Chat     │  │  Quiz / Flashcard Module  │  │
│  │  Module    │  │  Module    │  │                           │  │
│  └────────────┘  └────────────┘  └──────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │        Async Background Task (fire-and-forget)           │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────┬────────────────┬─────────────────┬──────────────────┘
            │                │                 │
            ▼                ▼                 ▼
    ┌──────────────┐  ┌───────────────┐  ┌──────────────────┐
    │  SQLite /    │  │  Qdrant       │  │  LLM + Embedding  │
    │  PostgreSQL  │  │  Vector DB    │  │  API (OpenAI /    │
    │  (port 5432) │  │  (port 6333)  │  │  Local Ollama)    │
    └──────────────┘  └───────────────┘  └──────────────────┘
```

---

## 2. Component Breakdown

| Component | Technology | Port | Responsibility |
|---|---|---|---|
| **Frontend SPA** | React.js + Vite | 3000 | User interface, state management |
| **API Server** | NestJS + TypeScript | 4000 | Business logic, REST endpoints |
| **Relational DB** | SQLite / PostgreSQL | 5432 | Persistent structured data |
| **Vector DB** | Qdrant | 6333 | Embedding storage & similarity search |
| **In-memory Cache** | NestJS CacheModule | — | Response caching (no Redis needed) |
| **LLM API** | OpenAI / Ollama | ext/11434 | Text generation, chat completion |
| **Embedding API** | OpenAI / multilingual-e5 | ext/— | Vector generation |

---

## 3. Frontend Architecture

See `frontend.md` for full detail.

```
src/
├── pages/
│   ├── HomePage.tsx           ← URL input + video list
│   ├── VideoPage.tsx          ← Main learning hub per video
│   ├── ChatPage.tsx           ← RAG chatbot interface
│   ├── QuizPage.tsx           ← Quiz taking UI
│   └── FlashcardPage.tsx      ← Flashcard review UI
├── components/
│   ├── VideoInput/
│   ├── SummaryCard/
│   ├── ChatInterface/
│   ├── QuizCard/
│   └── FlashcardViewer/
├── hooks/
│   ├── useVideoProcessing.ts
│   ├── useChat.ts
│   └── useQuiz.ts
├── services/
│   └── api.ts                 ← Axios API client
└── store/
    └── videoStore.ts          ← Zustand global state
```

### State Management

- **Zustand** for global state (current video, chat session, quiz state)
- **React Query (TanStack Query)** for server state, caching, and loading states
- Local component state for UI-only concerns (flip state, selected option)

---

## 4. Backend Architecture

See `backend.md` for full detail.

```
src/
├── modules/
│   ├── video/
│   │   ├── video.controller.ts
│   │   ├── video.service.ts
│   │   └── video.module.ts
│   ├── transcript/
│   │   ├── transcript.service.ts
│   │   ├── youtube-caption.service.ts
│   │   └── whisper.service.ts
│   ├── rag/
│   │   ├── rag.service.ts          ← orchestrates chunking + embedding + retrieval
│   │   ├── chunking.service.ts
│   │   ├── embedding.service.ts
│   │   └── vector-store.service.ts
│   ├── summary/
│   │   └── summary.service.ts
│   ├── chat/
│   │   ├── chat.controller.ts
│   │   └── chat.service.ts
│   ├── quiz/
│   │   ├── quiz.controller.ts
│   │   └── quiz.service.ts
│   └── flashcard/
│       ├── flashcard.controller.ts
│       └── flashcard.service.ts
├── common/
│   ├── llm/
│   │   └── llm.service.ts          ← LLM API abstraction
│   ├── guards/
│   └── interceptors/
└── config/
    └── configuration.ts
```

### Module Dependency Graph

```
VideoModule
    │
    ├── TranscriptModule (extracts transcript)
    │         │
    │         └── RAGModule (chunks + embeds)
    │                   │
    │                   └── VectorStoreService (Qdrant)
    │                   └── EmbeddingService (OpenAI/local)
    │
    ├── SummaryModule (LLM-based)
    ├── QuizModule (LLM-based)
    ├── FlashcardModule (LLM-based)
    └── ChatModule
              │
              └── RAGModule (retrieval)
              └── LLMService (generation)
```

---

## 5. AI Pipeline Architecture

### 5.1 Ingestion Pipeline (Async Background Task)

```
[Trigger: POST /videos]
         │
         ▼
┌─────────────────────────────────────────────────┐
│ Step 1: Transcript Extraction                    │
│  → Try YouTube Caption API first                 │
│  → Fallback: Whisper (speech-to-text)            │
│  → Store raw transcript in DB                    │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ Step 2: Chunking                                 │
│  → Sliding window: 500 tokens, 50 overlap        │
│  → Sentence-boundary aware splitting             │
│  → Store chunks in DB                            │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ Step 3: Embedding Generation                     │
│  → Batch chunks (20 at a time)                   │
│  → Call embedding API per batch                  │
│  → Receive float32 vector per chunk              │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ Step 4: Vector Store Upsert                      │
│  → Upsert all (chunk_id, vector, payload) to     │
│    Qdrant collection `video_chunks`              │
└─────────────────────┬───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│ Step 5: Summary Generation                       │
│  → Concatenate first N chunks (within LLM limit) │
│  → Prompt LLM for key points + summary           │
│  → Store in summaries table                      │
└─────────────────────────────────────────────────┘
```

### 5.2 RAG Query Pipeline (Synchronous)

```
[User asks question]
         │
         ▼
┌────────────────────────────────────────────────┐
│ Step 1: Query Embedding                         │
│  → Embed user question → query_vector           │
└────────────────────────┬───────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────┐
│ Step 2: Vector Similarity Search                │
│  → Qdrant: cosine similarity                    │
│  → Filter: video_id = <current video>           │
│  → Return top_k = 5 chunks                      │
└────────────────────────┬───────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────┐
│ Step 3: Context Assembly                        │
│  → Rank by score, deduplicate                   │
│  → Format: numbered list of chunk contents      │
│  → Include chat history (last N turns)          │
└────────────────────────┬───────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────┐
│ Step 4: LLM Prompt Construction                 │
│  → System prompt: "Answer ONLY from context"    │
│  → Context block: retrieved chunks              │
│  → History block: prior messages                │
│  → User query                                   │
└────────────────────────┬───────────────────────┘
                         │
                         ▼
┌────────────────────────────────────────────────┐
│ Step 5: LLM Generation                          │
│  → Call LLM API (streaming or non-streaming)    │
│  → Parse response                               │
│  → Store message + retrieved_chunk_ids          │
└────────────────────────────────────────────────┘
```

---

## 6. Data Flow (End-to-End)

### 6.1 Video Processing Flow

```
Browser → POST /api/videos { url: "https://youtube.com/watch?v=..." }
        ← 202 Accepted { videoId, status: "pending" }

[Background Task — fire-and-forget, no queue needed]
  youtube-caption.service → fetch transcript XML
  chunking.service        → split into chunks[]
  embedding.service       → embed chunks[] → vectors[]
  vector-store.service    → upsert to Qdrant
  summary.service         → LLM call → summary
  video.service           → UPDATE status = 'completed'

Browser → GET /api/videos/:id (polling or SSE)
        ← { status: "completed", summary: {...} }
```

### 6.2 Chat Flow

```
Browser → POST /api/chat/sessions { videoId }
        ← { sessionId }

Browser → POST /api/chat/sessions/:id/messages { content: "RAG là gì?" }

Server:
  embedding.service       → embed query → q_vector
  qdrant.search           → [chunk1, chunk2, chunk3, chunk4, chunk5]
  chat.service            → build prompt
  llm.service             → generate answer
  chat_messages.INSERT    → store user + assistant messages

        ← { content: "RAG là...", sources: [chunkId1, chunkId2] }
```

---

## 7. Local Dev Design

### 7.1 Async Processing (Simple Background Task)

```
POST /videos
    │
    └─→ VideoService.create()
              │
              └─→ processVideoInBackground() ← fire-and-forget (no await)
                    ├── status: pending → processing → completed
                    ├── Error caught → status: failed
                    └── Frontend polls GET /videos/:id every 3s
```

Không cần Redis, không cần BullMQ. Nếu server restart trong khi đang xử lý, video giữ trạng thái `processing` → user có thể bấm **Reprocess** để chạy lại.

### 7.2 Caching Strategy

| Data | Cache Key | TTL | Strategy |
|---|---|---|---|
| Video metadata | `video:{id}` | 1 hour | Cache-aside |
| Summary | `summary:{videoId}` | 24 hours | Cache-aside |
| Quiz | `quiz:{videoId}` | 24 hours | Cache-aside |
| Flashcards | `flashcards:{videoId}` | 24 hours | Cache-aside |
| Chat history | `chat:{sessionId}` | 30 min | Write-through |

### 7.3 Token Budget Management

To stay within LLM context limits:

| Feature | Strategy |
|---|---|
| Summary | Use first 4000 tokens of transcript (map-reduce for long videos) |
| Quiz | Generate in batches of 5 questions with separate prompts |
| Flashcards | Generate in batches of 8 cards |
| Chat | Limit to top_k=5 chunks + last 6 messages of history |

---

## 8. Technology Choices Justification

### NestJS (Backend)

- **Modular architecture** maps directly to system features
- **Built-in DI** simplifies service composition and testability
- **TypeScript-first** ensures type safety across the full API surface
- **Decorator-based routing** reduces boilerplate
- **First-class support** for TypeORM, CacheModule, Swagger

### React.js (Frontend)

- **Component model** maps cleanly to chat UI, quiz cards, flashcard flippers
- **Large ecosystem**: React Query for server state, Zustand for client state
- **Vite** for fast local dev builds
- Community familiarity for maintenance

### Qdrant (Vector DB)

- **Written in Rust** — extremely fast and low memory footprint
- **Runs locally** without Docker via qdrant binary or qdrant-client embedded
- **Payload filtering** enables per-video scoping natively
- **HNSW indexing** provides millisecond-level similarity search
- REST + gRPC API compatible with Node.js client

### LLM API (OpenAI / Ollama)

- **OpenAI**: High quality, great Vietnamese support via GPT-4o, simple API
- **Ollama (local fallback)**: No API cost, fully offline, models like `qwen2.5` support Vietnamese
- Abstracted behind `LLMService` — swap without changing business logic

### Embedding Model

- **`text-embedding-3-small`** (OpenAI): 1536-dim, strong multilingual
- **`multilingual-e5-base`** (HuggingFace local): 768-dim, excellent Vietnamese, no API cost
- Selection based on cost/quality tradeoff; configurable via env

### No BullMQ / No Redis (local design decision)

- Video processing uses **fire-and-forget async** within the NestJS process
- Caching uses **NestJS built-in in-memory CacheModule** (zero dependencies)
- Eliminates the need to run Redis locally
- If scaling to production/multi-user in the future: swap background task for BullMQ + Redis with minimal code change
