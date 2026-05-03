# Project Rules & Conventions
## AI Video Learning Assistant

**Version:** 1.0.0 | **Date:** 2026-05-03

---

## 1. General Constraints

| Rule | Detail |
|---|---|
| **No Docker** | Run all services natively on host machine |
| **Local only** | No cloud deployment; localhost dev environment |
| **Vietnamese priority** | All AI models must perform well on Vietnamese text |
| **No secrets in git** | All API keys in `.env`, `.env` in `.gitignore` |
| **TypeScript strict** | `"strict": true` in all tsconfig files |

---

## 2. Code Style

### Naming Conventions

| Type | Convention | Example |
|---|---|---|
| Files (NestJS) | `kebab-case.type.ts` | `video.service.ts` |
| Classes | `PascalCase` | `VideoService` |
| Functions/variables | `camelCase` | `extractTranscript()` |
| Constants | `UPPER_SNAKE_CASE` | `CHUNK_SIZE` |
| DB columns | `snake_case` | `youtube_id` |
| TypeScript types/interfaces | `PascalCase` | `VideoStatus` |
| React components | `PascalCase` | `ChatWindow.tsx` |
| CSS classes | Tailwind utilities only | `bg-indigo-500` |

### Code Rules

- Max function length: **50 lines** — extract to helpers if longer
- No `any` type in TypeScript
- Always use `async/await`, never raw `.then()` chains
- All DTOs must use `class-validator` decorators
- No business logic in controllers — controllers delegate to services only
- Services must not import other feature module controllers

---

## 3. Environment Setup

### Required Services (local)

```
Qdrant     → localhost:6333   (download qdrant.exe from qdrant.tech/download)
```

Không cần Redis — không dùng BullMQ, cache là in-memory.

### Startup Order

```
1. Start Qdrant
2. Start NestJS backend (npm run start:dev)
3. Start React frontend (npm run dev)
```

### `.env` required keys

```
OPENAI_API_KEY or OLLAMA_MODEL configured
QDRANT_HOST, QDRANT_PORT
DB_TYPE (sqlite for dev)
```

---

## 4. AI / RAG Rules

- **Never hallucinate**: LLM system prompt must explicitly forbid answers outside context
- **Always filter by video_id** in Qdrant queries — no cross-video contamination
- **Fallback message** when context insufficient: `"Thông tin này không có trong video."`
- **Chunk size**: 500 tokens default, 50 token overlap — do not reduce below 200 tokens
- **Top-K retrieval**: default 5 — do not exceed 10 (context window budget)
- **Temperature**: summary=0.3, chat=0.2, quiz=0.5, flashcard=0.4
- Vietnamese text: prefer `multilingual-e5-base` embedding over English-only models

---

## 5. API Rules

- All endpoints prefixed with `/api`
- Always return consistent error shape: `{ statusCode, message, timestamp }`
- Use `202 Accepted` for async operations (video processing)
- Validate all inputs with `class-validator` + `ValidationPipe`
- Never expose internal stack traces in responses
- Use UUIDs for all resource IDs

---

## 6. Git Conventions

### Branch Naming

```
feature/<short-name>     feature/rag-chunking
fix/<short-name>         fix/embedding-batch-error
chore/<short-name>       chore/update-deps
```

### Commit Message Format (Conventional Commits)

```
feat: add flashcard generation endpoint
fix: handle missing YouTube captions gracefully
chore: update openai sdk to v4
docs: add chunking strategy to architecture.md
refactor: extract prompt templates to constants
```

---

## 7. Testing Rules

- Unit tests: all services must have test files (`*.service.spec.ts`)
- Mock all external APIs (OpenAI, Qdrant) in unit tests
- Integration tests for critical paths: video ingestion, RAG query
- Test file location: co-located with source (`video.service.spec.ts`)
- Run tests: `npm run test` (unit), `npm run test:e2e` (e2e)

---

## 8. Folder Structure Rules

- No circular module imports in NestJS
- Shared types go in `src/common/types/` or `src/types/` (frontend)
- All LLM prompt strings go in `src/common/llm/prompts.ts` — never inline in services
- Environment config accessed only via `ConfigService` — never `process.env` directly in services
