# Data Schema
## AI Video Learning Assistant

**Version:** 1.0.0  
**Date:** 2026-05-03  

---

## Table of Contents

1. [Overview](#1-overview)
2. [Relational Database Schema](#2-relational-database-schema)
3. [Vector Database Schema](#3-vector-database-schema)
4. [Entity Relationship Diagram](#4-entity-relationship-diagram)
5. [Data Flow & Lifecycle](#5-data-flow--lifecycle)
6. [Indexes & Performance](#6-indexes--performance)

---

## 1. Overview

The system uses **two storage layers**:

| Layer | Technology | Purpose |
|---|---|---|
| **Relational DB** | SQLite (dev) / PostgreSQL (upgrade path) | Structured data: videos, transcripts, quizzes, flashcards, chat sessions |
| **Vector DB** | Qdrant (local instance) | Embedding vectors for RAG retrieval |

All data stays local. No cloud storage.

---

## 2. Relational Database Schema

### 2.1 `videos` Table

Stores metadata for each processed YouTube video.

```sql
CREATE TABLE videos (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_id    VARCHAR(20) NOT NULL UNIQUE,   -- e.g. "dQw4w9WgXcQ"
  url           TEXT        NOT NULL,
  title         VARCHAR(500),
  duration_sec  INTEGER,
  language      VARCHAR(10) DEFAULT 'vi',       -- ISO 639-1
  status        VARCHAR(20) NOT NULL DEFAULT 'pending',
                            -- pending | processing | completed | failed
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

**Status lifecycle:**
```
pending → processing → completed
                    ↘ failed
```

---

### 2.2 `transcripts` Table

Stores the raw extracted transcript per video.

```sql
CREATE TABLE transcripts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id      UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  raw_text      TEXT        NOT NULL,           -- full transcript text
  source        VARCHAR(20) NOT NULL,           -- 'youtube_caption' | 'whisper'
  word_count    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_transcripts_video_id ON transcripts(video_id);
```

---

### 2.3 `chunks` Table

Stores individual text chunks produced by the chunking pipeline.

```sql
CREATE TABLE chunks (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  transcript_id   UUID        NOT NULL REFERENCES transcripts(id) ON DELETE CASCADE,
  content         TEXT        NOT NULL,         -- chunk text
  chunk_index     INTEGER     NOT NULL,         -- order within transcript
  token_count     INTEGER,
  start_char      INTEGER,                      -- char offset in raw transcript
  end_char        INTEGER,
  embedding_id    VARCHAR(100),                 -- Qdrant point ID reference
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chunks_video_id     ON chunks(video_id);
CREATE INDEX idx_chunks_transcript   ON chunks(transcript_id);
CREATE INDEX idx_chunks_index        ON chunks(video_id, chunk_index);
```

---

### 2.4 `summaries` Table

Stores AI-generated summaries for each video.

```sql
CREATE TABLE summaries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  key_points      JSONB       NOT NULL,         -- string[]
  simplified_text TEXT        NOT NULL,
  main_topics     JSONB,                        -- string[]
  model_used      VARCHAR(100),
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_summaries_video_id ON summaries(video_id);
```

**`key_points` JSONB example:**
```json
[
  "Mô hình RAG kết hợp retrieval với generation",
  "Chunking ảnh hưởng trực tiếp đến chất lượng retrieval",
  "Vector search dùng cosine similarity"
]
```

---

### 2.5 `quizzes` Table

Stores quiz sets generated per video.

```sql
CREATE TABLE quizzes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  title       VARCHAR(200),
  total_questions INTEGER NOT NULL DEFAULT 0,
  model_used  VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quizzes_video_id ON quizzes(video_id);
```

---

### 2.6 `quiz_questions` Table

Stores individual questions belonging to a quiz.

```sql
CREATE TABLE quiz_questions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id         UUID        NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  question_text   TEXT        NOT NULL,
  options         JSONB       NOT NULL,   -- { A: string, B: string, C: string, D: string }
  correct_option  CHAR(1)     NOT NULL,   -- 'A' | 'B' | 'C' | 'D'
  explanation     TEXT,
  question_index  INTEGER     NOT NULL,
  source_chunk_id UUID        REFERENCES chunks(id)
);

CREATE INDEX idx_quiz_questions_quiz ON quiz_questions(quiz_id);
```

**`options` JSONB example:**
```json
{
  "A": "Cosine similarity",
  "B": "Euclidean distance only",
  "C": "Keyword matching",
  "D": "BM25 ranking"
}
```

---

### 2.7 `flashcard_sets` Table

Stores flashcard collections per video.

```sql
CREATE TABLE flashcard_sets (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  title       VARCHAR(200),
  total_cards INTEGER     NOT NULL DEFAULT 0,
  model_used  VARCHAR(100),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flashcard_sets_video ON flashcard_sets(video_id);
```

---

### 2.8 `flashcards` Table

Stores individual flashcard Q&A pairs.

```sql
CREATE TABLE flashcards (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id          UUID        NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
  front           TEXT        NOT NULL,    -- question / concept
  back            TEXT        NOT NULL,    -- answer / explanation
  card_index      INTEGER     NOT NULL,
  source_chunk_id UUID        REFERENCES chunks(id)
);

CREATE INDEX idx_flashcards_set ON flashcards(set_id);
```

---

### 2.9 `chat_sessions` Table

Stores chat sessions scoped to a video.

```sql
CREATE TABLE chat_sessions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id    UUID        NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  title       VARCHAR(200) DEFAULT 'New Chat',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_sessions_video ON chat_sessions(video_id);
```

---

### 2.10 `chat_messages` Table

Stores individual messages within a chat session.

```sql
CREATE TABLE chat_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL,    -- 'user' | 'assistant'
  content         TEXT        NOT NULL,
  retrieved_chunks JSONB,                 -- chunk IDs used as context (assistant only)
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created ON chat_messages(session_id, created_at);
```

**`retrieved_chunks` JSONB example:**
```json
["chunk-uuid-1", "chunk-uuid-2", "chunk-uuid-3"]
```

---

## 3. Vector Database Schema

### 3.1 Qdrant Collection: `video_chunks`

Each Qdrant **point** represents one transcript chunk.

```
Collection: video_chunks
Vector size: 1536 (OpenAI text-embedding-3-small)
            OR
            768 (multilingual-e5-base for Vietnamese)
Distance metric: Cosine
```

#### Point Structure

```json
{
  "id": "chunk-uuid-string",
  "vector": [0.023, -0.145, 0.312, ...],
  "payload": {
    "video_id":       "video-uuid",
    "youtube_id":     "dQw4w9WgXcQ",
    "chunk_index":    5,
    "content":        "Trong RAG, quá trình retrieval...",
    "token_count":    487,
    "start_char":     2340,
    "end_char":       4890,
    "language":       "vi"
  }
}
```

#### Qdrant Index Configuration

```json
{
  "hnsw_config": {
    "m": 16,
    "ef_construct": 100,
    "full_scan_threshold": 10000
  },
  "optimizers_config": {
    "default_segment_number": 2
  },
  "on_disk_payload": false
}
```

### 3.2 Payload Filters

All vector searches are scoped to a specific video using payload filter:

```json
{
  "filter": {
    "must": [
      { "key": "video_id", "match": { "value": "<video-uuid>" } }
    ]
  },
  "limit": 5,
  "with_payload": true
}
```

---

## 4. Entity Relationship Diagram

```
videos
  │
  ├──< transcripts (1:1 effectively, 1:many for reprocessing)
  │         │
  │         └──< chunks (1:many)
  │                   │
  │                   └── [embedding stored in Qdrant, referenced by embedding_id]
  │
  ├──< summaries (1:1)
  │
  ├──< quizzes (1:many)
  │         │
  │         └──< quiz_questions (1:many)
  │
  ├──< flashcard_sets (1:many)
  │         │
  │         └──< flashcards (1:many)
  │
  └──< chat_sessions (1:many)
            │
            └──< chat_messages (1:many)
```

---

## 5. Data Flow & Lifecycle

### 5.1 Video Ingestion

```
1. POST /videos { url }
   → INSERT videos (status: 'pending')
   → Enqueue processing job

2. Job Worker picks up job:
   → UPDATE videos (status: 'processing')
   → Extract transcript → INSERT transcripts
   → Chunk text → INSERT chunks (bulk)
   → Generate embeddings → Upsert into Qdrant
   → Generate summary → INSERT summaries
   → UPDATE videos (status: 'completed')
```

### 5.2 Chat Query

```
1. POST /chat/:sessionId/messages { content }
   → INSERT chat_messages (role: 'user')
   → Embed user query → vector
   → Qdrant search (filter: video_id, top_k: 5)
   → Build prompt with retrieved chunks
   → LLM API call
   → INSERT chat_messages (role: 'assistant', retrieved_chunks: [...])
   → Return response
```

### 5.3 Deletion Cascade

Deleting a `video` cascades to:
- `transcripts` → `chunks` (Qdrant points deleted via post-delete hook)
- `summaries`
- `quizzes` → `quiz_questions`
- `flashcard_sets` → `flashcards`
- `chat_sessions` → `chat_messages`

---

## 6. Indexes & Performance

| Table | Index | Reason |
|---|---|---|
| `videos` | `youtube_id` UNIQUE | Deduplication on ingestion |
| `transcripts` | `video_id` | Fast lookup by video |
| `chunks` | `video_id, chunk_index` | Ordered chunk retrieval |
| `chat_messages` | `session_id, created_at` | Chronological message loading |
| `quizzes` | `video_id` | Quiz list per video |
| `flashcards` | `set_id` | Card list per set |

### Qdrant Performance Notes

- Use **HNSW** index for approximate nearest neighbor search (fast, ~10ms per query)
- Always filter by `video_id` in payload to scope search — avoids cross-video contamination
- Keep `ef` parameter at 64–128 for balance of speed vs. recall
- For Vietnamese text, prefer `multilingual-e5-base` or `paraphrase-multilingual-mpnet-base-v2`
