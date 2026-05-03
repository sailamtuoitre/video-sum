# Technical Deep Dive
## AI Video Learning Assistant — RAG Pipeline & AI Layer

**Version:** 1.0.0  
**Date:** 2026-05-03  

---

## Table of Contents

1. [RAG Architecture Overview](#1-rag-architecture-overview)
2. [Chunking Strategy](#2-chunking-strategy)
3. [Embedding Pipeline](#3-embedding-pipeline)
4. [Vector Search](#4-vector-search)
5. [Context Injection & Prompt Engineering](#5-context-injection--prompt-engineering)
6. [Anti-Hallucination Design](#6-anti-hallucination-design)
7. [Transcript Extraction Layer](#7-transcript-extraction-layer)
8. [Summary Generation](#8-summary-generation)
9. [Quiz Generation](#9-quiz-generation)
10. [Flashcard Generation](#10-flashcard-generation)
11. [Model Selection for Vietnamese](#11-model-selection-for-vietnamese)
12. [Performance & Trade-offs](#12-performance--trade-offs)

---

## 1. RAG Architecture Overview

### What is RAG?

Retrieval-Augmented Generation (RAG) is a hybrid AI architecture that combines:

1. **Retrieval**: Finding relevant pieces of information from a knowledge base (vector DB)
2. **Augmented**: Injecting those pieces as context into the LLM prompt
3. **Generation**: LLM generates an answer grounded in the provided context

Without RAG, an LLM answers from parametric memory (training data) — unreliable for specific, private, or recent content like a YouTube video. With RAG, the LLM is constrained to the video's actual content.

### RAG vs. Fine-Tuning

| Aspect | RAG | Fine-Tuning |
|---|---|---|
| Knowledge update | Dynamic (re-index) | Requires retraining |
| Hallucination control | Strong (context grounding) | Weaker |
| Cost | Low (inference only) | High (training) |
| Per-video isolation | Native (filter by video_id) | Impossible |
| **Our choice** | ✅ | ❌ |

### Full RAG Pipeline Diagram

```
┌─────────────────────────────── INDEXING PHASE ──────────────────────────────┐
│                                                                               │
│  YouTube Video                                                                │
│       │                                                                       │
│       ▼                                                                       │
│  [Transcript Extraction]  ──────────────────────────────┐                    │
│   YouTube Caption API                                    │                    │
│   OR Whisper STT                                         ▼                    │
│       │                                       [Raw Text: "Trong bài học      │
│       │                                        này chúng ta sẽ tìm hiểu..."] │
│       ▼                                                  │                    │
│  [Chunking]                                              │                    │
│   Sliding window                                         │                    │
│   500 tokens / 50 overlap                                │                    │
│       │                                                  │                    │
│       ▼                                                  │                    │
│  [Embedding Generation]                                  │                    │
│   multilingual-e5-base / OpenAI                          │                    │
│       │                                                  │                    │
│       ▼                                                  │                    │
│  [Qdrant Upsert]                                         │                    │
│   Collection: video_chunks                               │                    │
│   Payload: { video_id, content, chunk_index }            │                    │
│                                                          │                    │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────── QUERY PHASE ─────────────────────────────────┐
│                                                                               │
│  User Question: "RAG hoạt động như thế nào?"                                 │
│       │                                                                       │
│       ▼                                                                       │
│  [Query Embedding]                                                            │
│   Same model as indexing (CRITICAL)                                           │
│       │                                                                       │
│       ▼                                                                       │
│  [Vector Search in Qdrant]                                                    │
│   Filter: video_id = <current video>                                          │
│   Top-K = 5, Distance: Cosine                                                 │
│       │                                                                       │
│       ▼                                                                       │
│  [Context Assembly]                                                           │
│   Chunk 1 (score: 0.94): "RAG kết hợp retrieval..."                          │
│   Chunk 2 (score: 0.88): "Trong pipeline RAG..."                              │
│   ...                                                                         │
│       │                                                                       │
│       ▼                                                                       │
│  [LLM Prompt Construction]                                                    │
│   System: "Chỉ trả lời từ CONTEXT bên dưới"                                  │
│   Context: [5 chunks]                                                         │
│   History: [last 6 messages]                                                  │
│   Query: "RAG hoạt động như thế nào?"                                         │
│       │                                                                       │
│       ▼                                                                       │
│  [LLM Generation]                                                             │
│   Answer: "RAG hoạt động bằng cách..."                                        │
│   Sources: [chunk_id_1, chunk_id_2]                                           │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Chunking Strategy

### Why Chunking Matters

The quality of RAG retrieval is directly determined by chunk quality:
- **Too large chunks**: Less precise retrieval, dilutes relevance, may exceed embedding model limits
- **Too small chunks**: Loses context, fragments meaning, increases noise
- **Optimal**: Semantically complete units with minimal overlap

### Sliding Window Chunking

```
TRANSCRIPT:
"[0] Xin chào, hôm nay chúng ta sẽ học về RAG. [1] RAG là Retrieval-Augmented 
Generation. [2] Đây là kỹ thuật quan trọng trong AI hiện đại. [3] Chunking là 
bước đầu tiên trong pipeline RAG. [4] Mỗi chunk nên chứa một ý nghĩa hoàn 
chỉnh..."

CHUNK 1 (tokens 0-500):
"Xin chào, hôm nay chúng ta sẽ học về RAG. RAG là Retrieval-Augmented 
Generation. Đây là kỹ thuật quan trọng trong AI hiện đại. Chunking là 
bước đầu tiên trong pipeline RAG. Mỗi chunk nên..."

CHUNK 2 (tokens 450-950):  ← 50 token overlap with Chunk 1
"...Mỗi chunk nên chứa một ý nghĩa hoàn chỉnh. Vector embedding được tạo 
cho mỗi chunk. Qdrant lưu trữ các vector này..."
```

### Implementation

```ts
chunk(text: string): string[] {
  const sentences = this.splitIntoSentences(text);
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = this.estimateTokens(sentence);

    if (currentTokens + sentenceTokens > CHUNK_SIZE && current.length > 0) {
      chunks.push(current.join(' '));
      // Keep last N sentences as overlap
      const overlap = this.getOverlapSentences(current, OVERLAP_TOKENS);
      current = [...overlap, sentence];
      currentTokens = this.estimateTokens(current.join(' '));
    } else {
      current.push(sentence);
      currentTokens += sentenceTokens;
    }
  }

  if (current.length > 0) chunks.push(current.join(' '));
  return chunks;
}
```

### Sentence Splitting (Vietnamese-aware)

Vietnamese sentences end with: `. `, `! `, `? `, `.\n`  
The splitter must NOT break on:
- Decimal numbers: `3.14`
- Abbreviations: `TS.`, `PGS.TS.`
- Ellipsis: `...`

```ts
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-ZÁÀẢÃẠĂẮẰẲẴẶ])/gu;
```

### Chunking Parameters

| Parameter | Default | Range | Notes |
|---|---|---|---|
| `CHUNK_SIZE` | 500 tokens | 300–700 | Larger = more context, less precise |
| `CHUNK_OVERLAP` | 50 tokens | 30–100 | Ensures boundary context preserved |
| Token estimation | 1 token ≈ 0.75 Vietnamese chars | — | Use tiktoken for accuracy |

---

## 3. Embedding Pipeline

### What is an Embedding?

An embedding converts text into a dense float vector (e.g., 768 or 1536 dimensions) where:
- Semantically similar texts have **small cosine distance** (high similarity)
- Unrelated texts have **large cosine distance** (low similarity)

```
"RAG kết hợp retrieval và generation"  → [0.023, -0.145, 0.312, ...]  (768 dims)
"RAG combines retrieval and generation" → [0.021, -0.149, 0.308, ...]  ← similar!
"Tôi thích ăn phở"                     → [-0.213, 0.467, -0.089, ...]  ← different
```

### Embedding Model Options

#### Option A: OpenAI `text-embedding-3-small`
- **Dimensions:** 1536
- **Cost:** ~$0.02 per 1M tokens
- **Vietnamese quality:** Good (multilingual training)
- **Latency:** ~200ms per batch (API call)
- **Best for:** Production-quality results, budget permitting

#### Option B: `multilingual-e5-base` (local HuggingFace)
- **Dimensions:** 768
- **Cost:** Free (runs locally via `@xenova/transformers` or Python)
- **Vietnamese quality:** Excellent (trained on multilingual corpora)
- **Latency:** ~50ms per batch (CPU), ~10ms (GPU)
- **Best for:** Local dev, no API cost, best Vietnamese support

#### Option C: `paraphrase-multilingual-mpnet-base-v2`
- Strong semantic similarity for Vietnamese
- Good fallback for sentence-level embeddings

**Recommended:** `multilingual-e5-base` for local dev (Vietnamese quality + free)

### Embedding Batching

```ts
async embedBatch(texts: string[]): Promise<number[][]> {
  const BATCH_SIZE = 20;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    results.push(...response.data.map(d => d.embedding));
  }

  return results;
}
```

**Why batching?**  
- Single API call for 20 texts vs. 20 API calls = 20x fewer round-trips
- Respects API rate limits (tokens per minute)
- For a 60-min video (~100 chunks): 5 batch calls vs. 100 individual calls

### Critical Rule: Embedding Symmetry

> The **same embedding model** MUST be used for both indexing (chunks) and querying (user question).

Mixing models (e.g., indexing with `multilingual-e5` but querying with OpenAI) produces incompatible vector spaces → completely wrong retrieval results.

---

## 4. Vector Search

### Qdrant and HNSW

Qdrant uses **HNSW (Hierarchical Navigable Small World)** graph index for approximate nearest neighbor (ANN) search:

```
Layer 2 (sparse):  •         •              •
Layer 1 (medium):  • - • - • - • - • - • - •
Layer 0 (dense):   •-•-•-•-•-•-•-•-•-•-•-•-•

Search starts at top layer (coarse navigation),
drills down to find approximate nearest neighbors in O(log n)
```

**Performance:** ~1–5ms for 1M vectors at 95%+ recall.

### Cosine Similarity

Distance metric used: **Cosine similarity**

```
similarity(A, B) = (A · B) / (|A| × |B|)

Range: [-1, 1]
  1.0 = identical direction (most similar)
  0.0 = orthogonal (unrelated)
 -1.0 = opposite
```

For RAG retrieval, only top-K results with score > 0.7 are meaningful. Scores below 0.6 indicate the query has no good match in the video content.

### Search Configuration

```ts
// VectorStoreService
async search(queryVector: number[], videoId: string, topK = 5) {
  return this.qdrant.search('video_chunks', {
    vector: queryVector,
    filter: {
      must: [{ key: 'video_id', match: { value: videoId } }]
    },
    limit: topK,
    with_payload: true,
    score_threshold: 0.6,  // filter out low-relevance results
    params: { hnsw_ef: 128 }  // higher ef = better recall, slower
  });
}
```

### Why Score Threshold Matters

Without a threshold, if the user asks about a topic NOT in the video, Qdrant still returns top-K results (even if all scores are 0.3). The LLM would then hallucinate from irrelevant chunks.

**Solution:** If all retrieved chunks score < 0.6, return: `"Thông tin này không có trong video."`

---

## 5. Context Injection & Prompt Engineering

### Prompt Architecture

```
┌──────────────────────────────────────────────────────┐
│ SYSTEM PROMPT (fixed, defines LLM behavior)          │
├──────────────────────────────────────────────────────┤
│ CONTEXT BLOCK (dynamic, retrieved chunks)            │
├──────────────────────────────────────────────────────┤
│ HISTORY BLOCK (dynamic, last 6 messages)             │
├──────────────────────────────────────────────────────┤
│ USER QUERY (dynamic, current question)               │
└──────────────────────────────────────────────────────┘
```

### System Prompt (RAG Chat)

```
Bạn là trợ lý học tập AI. Nhiệm vụ của bạn là trả lời câu hỏi của người dùng 
DỰA TRÊN NỘI DUNG VIDEO được cung cấp trong [CONTEXT].

NGUYÊN TẮC BẮT BUỘC:
1. Chỉ trả lời từ thông tin trong [CONTEXT]. KHÔNG tự thêm thông tin ngoài.
2. Nếu câu hỏi không có trong context: trả lời "Thông tin này không có trong video."
3. Trích dẫn nguồn bằng [1], [2]... để tham chiếu đến đoạn context tương ứng.
4. Trả lời rõ ràng, dễ hiểu bằng tiếng Việt.
5. KHÔNG bịa thông tin. KHÔNG đoán mò.
```

### Context Block Format

```
[CONTEXT]
[1] Trong bài học này, chúng ta tìm hiểu về RAG. RAG là viết tắt của 
Retrieval-Augmented Generation, một kỹ thuật...

[2] Pipeline RAG bao gồm hai giai đoạn chính: indexing và querying. 
Trong giai đoạn indexing...

[3] Chunking là bước quan trọng nhất trong RAG. Nếu chunks quá lớn...
[/CONTEXT]
```

### Token Budget Management

A typical LLM context window (GPT-4o-mini): **128k tokens**

| Component | Token allocation |
|---|---|
| System prompt | ~200 tokens |
| 5 retrieved chunks (500 tokens each) | ~2,500 tokens |
| Chat history (6 messages avg 100 tokens) | ~600 tokens |
| User query | ~50 tokens |
| **Total input** | **~3,350 tokens** |
| LLM response (max) | ~500 tokens |
| **Total** | **~3,850 tokens** |

Well within limits. For long chats, truncate history to last 6 turns only.

---

## 6. Anti-Hallucination Design

### What is Hallucination?

LLMs "hallucinate" when they generate plausible-sounding but factually incorrect information not grounded in any source. For a video learning assistant, this is critical to prevent — a student asking "What did the professor say about X?" should not receive invented content.

### Multi-Layer Defense

#### Layer 1: System Prompt Constraints

Explicit prohibition in system prompt:
```
KHÔNG được bịa thêm thông tin ngoài [CONTEXT].
KHÔNG được sử dụng kiến thức nền của bạn để trả lời.
```

#### Layer 2: Score Threshold Filtering

If vector search returns no chunk with score ≥ 0.6:
```ts
if (results.every(r => r.score < 0.6)) {
  return { content: "Thông tin này không có trong video.", retrievedChunks: [] };
}
```
→ LLM never sees unrelated chunks; returns structured "not found" response.

#### Layer 3: Temperature Control

Low temperature (0.2) for chat completion reduces creative divergence from context.

#### Layer 4: Source Attribution

Every assistant response includes `retrievedChunks[]` — the exact chunk IDs used.  
Frontend displays these as "Source" chips, allowing users to verify answers.

#### Layer 5: Context-Only Framing (Grounding Framing)

Prompt explicitly frames the LLM role as a "reader" of provided context, not a "knower":
```
"Bạn chỉ có thể thấy những gì trong [CONTEXT]. Bạn không biết gì ngoài đó."
```

### Hallucination Detection (Future)

For production hardening, add a post-generation check:
- Run a verification LLM call: "Does this answer appear in the context? Yes/No"
- If "No": replace answer with fallback message

---

## 7. Transcript Extraction Layer

### Strategy

```
1. Try YouTube Caption API (fast, free, accurate)
   ↓ success → use it
   ↓ fail (no captions / disabled)
2. Download audio → Whisper STT (slower, requires ffmpeg)
   ↓ success → use it
   ↓ fail
3. Return error: "Không thể trích xuất transcript"
```

### YouTube Caption Extraction

Uses `youtube-transcript` npm package:

```ts
import { YoutubeTranscript } from 'youtube-transcript';

const segments = await YoutubeTranscript.fetchTranscript(youtubeId, {
  lang: 'vi',   // prefer Vietnamese
});

// Fallback to English if Vietnamese unavailable
if (!segments.length) {
  const enSegments = await YoutubeTranscript.fetchTranscript(youtubeId, { lang: 'en' });
}

// Concatenate segments into full text
const rawText = segments.map(s => s.text).join(' ');
```

### Whisper Fallback (Speech-to-Text)

When captions are unavailable:

```
1. yt-dlp download audio:
   yt-dlp -x --audio-format mp3 -o audio.mp3 <youtube_url>

2. Whisper transcription:
   Whisper model: whisper-1 (OpenAI API) or local openai/whisper-large-v3
   Language hint: "vi" for Vietnamese

3. Cost: ~$0.006/minute (OpenAI) or free (local)
```

**Local Whisper recommendation** for Vietnamese: `openai/whisper-large-v3` outperforms `whisper-1` for Vietnamese.

### Transcript Quality

Raw YouTube captions often contain:
- Missing punctuation
- Speaker overlap artifacts
- Filler words ("uh", "um", "à", "ờ")

**Post-processing:**
```ts
function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[.*?\]/g, '')       // remove [Music], [Applause]
    .replace(/\s{2,}/g, ' ')       // collapse whitespace
    .replace(/([a-zA-Z])\s+\1/gi, '$1')  // remove stutters
    .trim();
}
```

---

## 8. Summary Generation

### Strategy: Map-Reduce for Long Videos

For videos with transcripts exceeding LLM context limit (~4000 tokens):

```
LONG TRANSCRIPT (50,000 tokens)
         │
    ┌────┴────┐
    │  Split  │   → [Chunk group 1: tokens 0-4000]
    └────┬────┘     [Chunk group 2: tokens 4000-8000]
         │          [Chunk group 3: tokens 8000-12000]
         │                   ...
         ▼
    MAP PHASE: summarize each group → mini-summary[]
         │
         ▼
    REDUCE PHASE: combine mini-summaries → final summary
```

For short videos (< 4000 tokens): single LLM call.

### Summary Prompt

```
Hãy phân tích nội dung transcript sau và tạo:

1. KEY_POINTS: Tối đa 10 bullet points, mỗi điểm 1 câu ngắn gọn
2. SIMPLIFIED_TEXT: Đoạn văn 3-5 câu tóm tắt toàn bộ nội dung
3. MAIN_TOPICS: Danh sách 3-7 chủ đề chính được đề cập

Transcript:
{transcript}

Trả lời STRICTLY theo định dạng JSON:
{
  "key_points": ["...", "..."],
  "simplified_text": "...",
  "main_topics": ["...", "..."]
}
```

### Output Parsing

Always use JSON mode / structured output to prevent format errors:
- OpenAI: `response_format: { type: "json_object" }`
- Ollama: use grammar constraints or retry with `JSON.parse` + error handling

---

## 9. Quiz Generation

### Prompt Design

Key challenges:
1. Questions must be grounded in video content (not general knowledge)
2. Distractors (wrong options) must be plausible but clearly wrong
3. Questions must cover diverse parts of the video

### Approach: Chunk Sampling

Instead of sending the full transcript (token-expensive), sample diverse chunks:

```ts
async generateQuiz(videoId: string, numQuestions = 10): Promise<QuizQuestion[]> {
  // 1. Retrieve all chunks for this video
  const chunks = await this.chunkRepo.find({ where: { videoId } });

  // 2. Sample evenly across the video (spread coverage)
  const sampled = this.sampleEvenly(chunks, Math.min(chunks.length, 20));

  // 3. Generate in batches of 5 questions to stay within token limits
  const batches = Math.ceil(numQuestions / 5);
  const allQuestions: QuizQuestion[] = [];

  for (let i = 0; i < batches; i++) {
    const batchChunks = sampled.slice(i * 4, (i + 1) * 4);
    const questions = await this.llm.complete(
      this.buildQuizPrompt(batchChunks.map(c => c.content).join('\n\n'), 5)
    );
    allQuestions.push(...JSON.parse(questions.content));
  }

  return allQuestions.slice(0, numQuestions);
}
```

### Quiz Prompt

```
Dựa trên đoạn nội dung sau từ video:

{context}

Tạo {n} câu hỏi trắc nghiệm theo yêu cầu:
- Mỗi câu có 4 đáp án (A, B, C, D), chỉ 1 đáp án đúng
- Câu hỏi phải rõ ràng, không mơ hồ
- Đáp án nhiễu phải hợp lý nhưng sai
- Độ khó đa dạng (dễ, trung bình, khó)
- Thêm explanation ngắn giải thích đáp án đúng

Trả lời JSON array: [{ question_text, options: {A,B,C,D}, correct_option, explanation }]
```

---

## 10. Flashcard Generation

### Design Principles

Good flashcards follow the **minimum information principle**:
- Front: one question or concept per card
- Back: concise, direct answer (not a paragraph)

### Flashcard Prompt

```
Dựa trên nội dung sau, tạo {n} flashcard để học và ghi nhớ kiến thức.

Nguyên tắc:
- Mặt trước (front): Câu hỏi ngắn gọn HOẶC khái niệm cần nhớ (tối đa 15 từ)
- Mặt sau (back): Câu trả lời/giải thích đầy đủ nhưng súc tích (2-4 câu)
- Mỗi card về 1 khái niệm/sự kiện cụ thể
- Đa dạng loại: định nghĩa, so sánh, quy trình, ví dụ

Nội dung:
{context}

Trả lời JSON array: [{ front, back }]
```

### Example Output

```json
[
  {
    "front": "RAG là gì?",
    "back": "Retrieval-Augmented Generation — kỹ thuật kết hợp tìm kiếm thông tin từ knowledge base với LLM. Giúp LLM trả lời chính xác dựa trên dữ liệu thực tế thay vì chỉ dùng kiến thức từ training."
  },
  {
    "front": "Sự khác biệt giữa chunk size lớn và nhỏ?",
    "back": "Chunk lớn: context phong phú hơn nhưng retrieval kém chính xác. Chunk nhỏ: retrieval chính xác hơn nhưng mất ngữ cảnh. Khuyến nghị: 300-700 tokens với 10% overlap."
  }
]
```

---

## 11. Model Selection for Vietnamese

### Why Vietnamese Needs Special Attention

Vietnamese is a tonal language with:
- 6 tones (dấu huyền, sắc, hỏi, ngã, nặng, ngang)
- No spaces between syllables within words (unlike English)
- High-context meaning (same word different tone = different meaning)

English-trained embedding models significantly degrade on Vietnamese text.

### Recommended Models

#### Embedding
| Model | Quality (VI) | Speed | Cost |
|---|---|---|---|
| `multilingual-e5-base` | ⭐⭐⭐⭐⭐ | Fast (local) | Free |
| `text-embedding-3-small` | ⭐⭐⭐⭐ | Medium (API) | $0.02/1M tokens |
| `paraphrase-multilingual-mpnet-base-v2` | ⭐⭐⭐⭐ | Fast (local) | Free |

**Recommendation:** `multilingual-e5-base` via `@xenova/transformers` (Node.js native)

#### LLM for Text Generation
| Model | Quality (VI) | Cost |
|---|---|---|
| `gpt-4o` | ⭐⭐⭐⭐⭐ | $5/1M tokens |
| `gpt-4o-mini` | ⭐⭐⭐⭐ | $0.15/1M tokens (recommended) |
| `qwen2.5:7b` (Ollama) | ⭐⭐⭐⭐ | Free (local) |
| `vinallama` (Ollama) | ⭐⭐⭐⭐⭐ | Free (local, Vietnamese-specific) |

**Recommendation:** `gpt-4o-mini` for API, `qwen2.5:7b` or `vinallama` for offline local.

#### Speech-to-Text (Whisper)
| Model | Quality (VI) | Speed |
|---|---|---|
| `whisper-large-v3` | ⭐⭐⭐⭐⭐ | Slow |
| `whisper-medium` | ⭐⭐⭐⭐ | Medium |
| `whisper-1` (OpenAI API) | ⭐⭐⭐⭐ | Fast |

---

## 12. Performance & Trade-offs

### Latency Budget (per operation)

| Operation | P50 | P95 | Notes |
|---|---|---|---|
| YouTube caption fetch | 1–3s | 10s | Network dependent |
| Whisper transcription (API) | 5–30s | 60s | Depends on video length |
| Chunking (100 chunks) | < 100ms | 200ms | CPU-bound, fast |
| Embedding 100 chunks (API) | 2–5s | 10s | 5 batch calls |
| Embedding 100 chunks (local) | 0.5–2s | 5s | CPU/GPU dependent |
| Qdrant upsert (100 vectors) | < 500ms | 1s | Local, very fast |
| Summary generation | 3–8s | 15s | LLM latency |
| **Total pipeline (60-min video)** | **~30s** | **~90s** | |
| RAG query (vector search) | 5–20ms | 50ms | Qdrant HNSW |
| RAG query (embedding) | 200ms | 500ms | API call |
| LLM chat response | 1–3s | 8s | Streaming hides this |
| **Total chat response** | **~1.5s** | **~5s** | |

### Key Design Trade-offs

| Decision | Trade-off | Our Choice |
|---|---|---|
| Chunk size 500 vs 200 | Precision vs Context | 500 (more context for complex answers) |
| Top-K 5 vs 10 | Recall vs Context budget | 5 (sufficient, keeps prompt small) |
| Local embedding vs API | Cost vs Quality | Local `multilingual-e5-base` (free + better VI) |
| Streaming vs non-streaming | UX vs complexity | Stream chat responses (better UX) |
| SQLite vs PostgreSQL | Simplicity vs Power | SQLite for local dev (zero config) |
| HNSW ef=64 vs 128 | Speed vs Recall | 128 (recall quality is critical for RAG) |
