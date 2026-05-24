# Kế hoạch tối ưu `SummaryService`

> File: `src/summaries/summary.service.ts` (1116 dòng)  
> Ngày: 2026-05-23  
> **Lưu ý**: `module summarize3.md` là kế hoạch cho phiên bản cũ – các vấn đề về mojibake, prompt không dấu, parser, quality guard trong đó **đã được fix**. Kế hoạch này nhắm vào code hiện tại với focus: tách service, song song hóa LLM calls, và dọn dẹp.

---

## Mục lục

1. [Tổng quan kiến trúc hiện tại](#1-tổng-quan-kiến-trúc-hiện-tại)
2. [Vấn đề nghiêm trọng](#2-vấn-đề-nghiêm-trọng)
3. [Vấn đề trung bình](#3-vấn-đề-trung-bình)
4. [Cải tiến nhẹ](#4-cải-tiến-nhẹ)
5. [Kế hoạch triển khai](#5-kế-hoạch-triển-khai)
6. [Ước tính impact](#6-ước-tính-impact)

---

## 1. Tổng quan kiến trúc hiện tại

```
SummaryService (1116 dòng - God Service)
├── createFromVideo()           → Entry point tạo summary
├── buildAiSummaryDraft()       → Điều phối direct vs mapreduce
├── buildDirectAiSummaryDraft() → Gọi LLM 1 lần
├── buildMapReduceSummaryDraft()→ Map → Collapse → Reduce
│   ├── buildMapSummaries()     → Gọi LLM tuần tự từng group
│   ├── collapseMapSummariesIfNeeded() → Gọi LLM tuần tự
│   └── reduceSummaries()       → Gọi LLM 1 lần cuối
├── chunk selection & scoring   → Chọn chunk đại diện
├── JSON parsing & repair      → Parse & sửa JSON từ LLM
├── retry logic                → Retry với rate limit
└── quality checks             → Kiểm tra chất lượng output
```

**Vấn đề cốt lõi**: Một service duy nhất gánh quá nhiều trách nhiệm, map phase chạy tuần tự gây bottleneck nghiêm trọng.

---

## 2. Vấn đề nghiêm trọng

### 2.1 Map phase chạy tuần tự – Bottleneck lớn nhất

**Hiện trạng** (`buildMapSummaries`, dòng ~270-300):

```typescript
// ❌ Hiện tại: Gọi LLM từng group một
for (const [index, group] of groups.entries()) {
  const response = await this.invokeLlmWithRetry(
    () => this.invokeJsonLlm(llm, prompt),
    config,
  );
  summaries.push(parseResult);
}
```

Với 10 groups × ~3s/group = **~30s** thời gian chờ tuần tự.

**Giải pháp**:

```typescript
// ✅ Song song hóa với semaphore giới hạn concurrency
const CONCURRENCY = 3;
const semaphore = new ConcurrencySemaphore(CONCURRENCY);

const results = await Promise.allSettled(
  groups.map((group, index) =>
    semaphore.run(async () => {
      const response = await this.invokeLlmWithRetry(
        () => this.invokeJsonLlm(llm, this.promptBuilder.buildMapSummaryPrompt(index, group, config.chunkWordLimit)),
        config,
      );
      return this.parseMapSummary(this.extractMessageText(response.content), { groupIndex: index, chunks: group });
    })
  )
);
```

**Tác động tương tự** với `collapseMapSummariesIfNeeded` (dòng ~320-350).

### 2.2 God Service 1116 dòng – Quá nhiều trách nhiệm

Cần tách thành các service chuyên biệt:

| Service | Trách nhiệm | Số dòng tách |
|---|---|---|
| `LlmJsonParser` | `parseJsonObject`, `extractJsonCandidates`, `repairJsonCandidate`, `escapeControlCharactersInStrings`, `extractBalancedJsonObjects`, `extractMessageText`, `isTextContentPart` | ~180 |
| `SummaryQualityChecker` | `isLowQualitySummary`, `countEmptySimplifiedLabels`, `hasIntermediateContent` | ~70 |
| `LlmInvoker` | `createLlm`, `invokeJsonLlm`, `invokeLlmWithRetry`, `isRetryableLlmError`, `getRetryDelayMs`, `getRetryAfterMs`, `toErrorRecord`, `sleep` | ~100 |
| `ChunkSelector` | `selectSummaryChunks`, `scoreChunk`, `cleanChunks`, `groupChunks`, `groupItems` | ~80 |

**Sau khi tách**: `SummaryService` còn ~400 dòng, chỉ giữ logic orchestration.

---

## 3. Vấn đề trung bình

### 3.1 Trùng lặp code giữa Map và Collapse

Cả hai method có cấu trúc y hệt:

```
loop groups → build prompt → invoke LLM → parse JSON → push result
```

**Giải pháp**: Gộp thành generic method:

```typescript
private async batchProcess<TInput, TOutput>(
  items: TInput[][],
  buildPrompt: (index: number, group: TInput[]) => string,
  parseResponse: (content: string, fallback: TInput[]) => TOutput,
  llmConfig: { model: string; maxTokens: number },
): Promise<TOutput[]> { ... }
```

### 3.2 `console.warn` không nhất quán

Dòng 397 dùng `console.warn` thay vì NestJS Logger:

```typescript
// ❌ Hiện tại
console.warn(`Summary AI rate limited...`);

// ✅ Sửa thành
this.logger.warn(`Summary AI rate limited...`);
```

---

## 4. Cải tiến nhẹ

### 4.1 Dead code

```typescript
// ❌ Không dùng ở đâu, xóa đi
private readonly sentenceLimit = 180;
private readonly sectionSize = 4;
```

### 4.2 Hardcoded strings → Constants

```typescript
// ❌ Hiện tại: string rải rác trong code
const mathKeywords = ['bài toán', 'công thức', ...];

// ✅ Tách thành constants riêng
const MATH_KEYWORDS = [...] as const;
const QUALITY_MARKERS = [...] as const;
const SIMPLIFIED_LABELS = [...] as const;
```

### 4.3 Schema validation type guards

Type guards `isSummaryJson`, `isMapSummaryJson`, `isCollapsedSummaryJson` viết thủ công, dễ sai khi schema thay đổi. Có thể dùng Zod để vừa validate vừa infer type.

```typescript
// ✅ Zod schema = type + validation
const SummaryJsonSchema = z.object({
  keyPoints: z.array(z.string()),
  simplifiedText: z.string(),
  mainTopics: z.array(z.string()),
});
```

### 4.4 Progress tracking cho mapreduce

Khi mapreduce chạy lâu (đặc biệt sau khi song song hóa), người dùng không biết tiến độ. Thêm optional `onProgress` callback để frontend hiển thị trạng thái.

---

## 5. Kế hoạch triển khai

### Phase 1: Tách service (an toàn, có test) 

| Bước | Mô tả | Risk |
|---|---|---|
| 1.1 | Tạo `LlmJsonParser` service, move methods, test | Thấp |
| 1.2 | Tạo `SummaryQualityChecker` service, move methods, test | Thấp |
| 1.3 | Tạo `LlmInvoker` service, move methods, test | Thấp |
| 1.4 | Tạo `ChunkSelector` service, move methods, test | Thấp |
| 1.5 | Inject các service mới vào `SummaryService` | Thấp |
| 1.6 | Chạy full regression test | - |

### Phase 2: Song song hóa (impact lớn nhất)

| Bước | Mô tả | Risk |
|---|---|---|
| 2.1 | Implement `ConcurrencySemaphore` utility | Thấp |
| 2.2 | Song song hóa `buildMapSummaries` | Trung bình |
| 2.3 | Song song hóa `collapseMapSummariesIfNeeded` | Trung bình |
| 2.4 | Test với nhiều group size khác nhau | - |

### Phase 3: Gộp code trùng lặp

| Bước | Mô tả | Risk |
|---|---|---|
| 3.1 | Extract `batchProcess` generic method | Trung bình |
| 3.2 | Refactor `buildMapSummaries` dùng `batchProcess` | Trung bình |
| 3.3 | Refactor `collapseMapSummariesIfNeeded` dùng `batchProcess` | Trung bình |

### Phase 4: Cải tiến nhẹ

| Bước | Mô tả |
|---|---|
| 4.1 | Xóa dead code (`sentenceLimit`, `sectionSize`) |
| 4.2 | Extract hardcoded strings thành constants |
| 4.3 | Sửa `console.warn` → `this.logger.warn` |
| 4.4 | Thêm Zod schema validation |
| 4.5 | Thêm `onProgress` callback |

---

## 6. Ước tính impact

| Tối ưu | Giảm thời gian | Độ phức tạp |
|---|---|---|
| Song song hóa map phase (concurrency=3) | **~65%** (30s → ~11s) | Trung bình |
| Song song hóa collapse phase | **~50%** | Trung bình |
| **Tổng** | **30-50s → 12-18s** | |

| Tối ưu | Cải thiện maintainability |
|---|---|
| Tách 4 service | **Rất cao** – mỗi file <200 dòng, single responsibility |
| Gộp code Map/Collapse | **Cao** – giảm 60 dòng trùng lặp |
| Zod schema | **Cao** – type safety + validation tự động |

---

## Thứ tự ưu tiên đề xuất

1. **Phase 1** – Tách service trước để codebase sạch, dễ test
2. **Phase 2** – Song song hóa để có impact performance ngay
3. **Phase 3** – Gộp code trùng lặp sau khi đã ổn định
4. **Phase 4** – Cải tiến nhẹ, dọn dẹp
