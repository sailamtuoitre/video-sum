# Ke hoach sua va toi uu module summarize

## Muc tieu

Nang cap module `summaries` de ket qua tom tat on dinh hon, dung tieng Viet co dau, it bi mat y trong video dai, va co co che phat hien output kem truoc khi luu vao database.

Trong dot sua nay, uu tien xu ly loi logic va loi xu ly tieng Viet truoc khi tinh den thay doi model hoac prompt nang cao.

## Pham vi chinh

- `src/summaries/summary.service.ts`
- `src/summaries/summary-prompt.builder.ts`
- `src/summaries/summary-config.service.ts`
- `src/summaries/summary-text.service.ts`
- Cac script danh gia/chat eval neu can chay kiem chung sau khi sua

## Van de hien tai

### 1. Loi tieng Viet va encoding

Mot so chuoi trong `summary.service.ts` dang bi mojibake, vi du `bÃ i toÃ¡n`, `cÃ´ng thá»©c`, `Ä‘iá»u kiá»‡n`.

Tac dong:

- `scoreChunk()` co the cham diem sai vi keyword khong khop voi noi dung da normalize.
- Prompt va fallback co the lam LLM sinh output khong dau hoac ky tu loi.
- Bo loc chat luong co the bo sot output kem neu LLM tra ve tieng Viet co dau.

Huong sua:

- Chuyen toan bo prompt sang tieng Viet co dau trong `summary-prompt.builder.ts`.
- Sua cac chuoi loi encoding trong `summary.service.ts`.
- Khi so sanh keyword, normalize ca keyword va text bang `normalizeForCompare()` thay vi so sanh truc tiep chuoi co dau.

### 2. Loi so sanh `chunkIndex` voi do dai danh sach da loc

Hien trang trong `selectSummaryChunks()`:

```ts
const score = this.scoreChunk(chunk, cleanChunks.length);
```

Trong khi `scoreChunk()` so sanh:

```ts
if (chunk.chunkIndex >= totalChunks - 2) {
  score += 3;
}
```

Van de:

- `chunk.chunkIndex` la chi so goc.
- `cleanChunks.length` la do dai sau khi loc chunk rong.
- Neu co chunk rong bi loai, dieu kien nhan dien chunk cuoi video se bi lech.

Huong sua:

```ts
const totalChunkSpan =
  Math.max(...cleanChunks.map((chunk) => chunk.chunkIndex)) + 1;

const score = this.scoreChunk(chunk, totalChunkSpan);
```

Hoac truyen dung do dai danh sach goc neu chac chan `chunkIndex` lien tuc:

```ts
const score = this.scoreChunk(chunk, chunks.length);
```

Khuyen nghi dung `totalChunkSpan` vi no bam sat `chunkIndex` goc hon khi co khoang trong.

### 3. Deduplicate trong `selectSummaryChunks()` dang du thua

Hien trang:

```ts
return [...new Map(selected.map((chunk) => [chunk.chunkIndex, chunk])).values()]
  .sort((left, right) => left.chunkIndex - right.chunkIndex)
  .slice(0, maxChunks);
```

Nhan xet:

- Cac window duoc cat bang `slice(start, start + windowSize)` va `start += windowSize`.
- Cac window khong chong lan, nen `selected` binh thuong khong co duplicate.

Huong sua:

```ts
return selected
  .sort((left, right) => left.chunkIndex - right.chunkIndex)
  .slice(0, maxChunks);
```

Ghi chu:

- Neu muon phong thu truong hop database co duplicate `chunkIndex`, co the giu dedupe.
- Neu uu tien code gon va dung logic hien tai, bo `Map` la hop ly.

### 4. `isLowQualitySummary()` bo sot tieng Viet co dau

Hien trang:

```ts
const joined = [
  draft.simplifiedText,
  ...draft.keyPoints,
  ...draft.mainTopics,
]
  .join(' ')
  .toLowerCase();
```

Trong khi markers la khong dau:

```ts
const insufficientMarkers = [
  'khong du',
  'thieu du',
  'khong co du',
  'not enough',
  'insufficient',
];
```

Van de:

- `"không đủ"` khong match `"khong du"`.
- `"thiếu dữ liệu"` khong match `"thieu du"`.

Huong sua:

```ts
const joined = this.text.normalizeForCompare(
  [draft.simplifiedText, ...draft.keyPoints, ...draft.mainTopics].join(' '),
);
```

Sau do giu markers dang khong dau.

### 5. `countEmptySimplifiedLabels()` khong nhan nhan co dau

Hien trang:

```ts
const labels = [
  '1. Chu de chinh:',
  '2. Giai thich:',
  '3. Vi du minh hoa:',
  '4. Ket luan:',
];
const normalized = this.text.normalizeWhitespace(text);
```

Van de:

- Neu LLM tra ve `"1. Chủ đề chính:"`, ham `indexOf('1. Chu de chinh:')` se khong tim thay.
- Cac summary kem chat luong co nhan rong van co the vuot qua quality guard.

Huong sua:

- Normalize ca text va label bang `normalizeForCompare()`.
- Hoac dung regex chap nhan ca co dau va khong dau.

De xuat don gian:

```ts
const normalized = this.text.normalizeForCompare(text);
const labels = [
  '1 chu de chinh',
  '2 giai thich',
  '3 vi du minh hoa',
  '4 ket luan',
];
```

Can can than vi `normalizeForCompare()` loai dau cau, nen logic cat `tail` can duoc viet lai theo cach phu hop.

### 6. Parser map/collapse dang loc mem qua muc

Hien trang:

- `parseMapSummary()` parse JSON roi dung `asRecord()`.
- Neu JSON hop le nhung sai schema, code van tao `MapSummary` voi mang rong.
- `isMapSummaryJson()` va `isCollapsedSummaryJson()` ton tai nhung chua duoc su dung.

Tac dong:

- Reduce co the nhan intermediate summaries thieu y.
- Output cuoi co the nghe dung format nhung thieu noi dung quan trong.

Huong sua:

- Dung `isMapSummaryJson()` trong `parseMapSummary()`.
- Dung `isCollapsedSummaryJson()` trong `parseCollapsedSummary()`.
- Neu schema sai hoac noi dung qua rong, throw error de caller dung fallback tu chunk goc.

Vi du huong sua:

```ts
const parsed = this.parseJsonObject(content);

if (!this.isMapSummaryJson(parsed)) {
  throw new Error('AI map summary response does not match expected schema.');
}
```

Sau do moi clean field.

### 7. Prompt chua toi uu cho tieng Viet co dau va output hoc tap

Hien trang:

- Prompt hien dang khong dau.
- Cau lenh dung nhung chua du manh ve viec giu cong thuc, dieu kien, vi du, buoc giai.

Huong sua:

- Viet lai prompt co dau.
- `MAP` tap trung trich y, cong thuc, dieu kien, buoc giai, vi du, thong tin thieu.
- `COLLAPSE` chi gop trung, khong lam mat cong thuc hoac buoc giai.
- `REDUCE` tao ban cuoi co cau truc:
  - Chu de chinh
  - Giai thich
  - Vi du minh hoa
  - Ket luan
- Yeu cau output JSON hop le, khong markdown, khong them kien thuc ngoai nguon.

### 8. Fallback extractive con yeu

Hien trang:

- `buildChunkDigest()` chi lay mot vai cau dau.
- `extractKeyPoints()` chon cau dua tren do dai va unique key.
- `extractMainTopics()` co the tra ve topic tieng Anh nhu `linear equation`, `integral`, `geometry`.

Tac dong:

- Khi Groq loi hoac output AI bi fallback, summary co the nghe ngheo nan.

Huong sua:

- Uu tien cau co dau hieu bai toan, cong thuc, dieu kien, vi du, buoc giai, ket luan.
- Doi math topics sang tieng Viet:
  - `phuong trinh bac nhat`
  - `phuong trinh bac hai`
  - `he phuong trinh`
  - `ham so`
  - `dao ham`
  - `tich phan`
  - `hinh hoc`
  - `xac suat`
  - `thong ke`
  - `vector`
- Normalize keyword truoc khi match.

## Thu tu thuc hien de xuat

### Phase 1: Sua loi nen tang

1. Sua mojibake trong `summary.service.ts`.
2. Sua prompt khong dau trong `summary-prompt.builder.ts`.
3. Sua `scoreChunk()` de so sanh `chunkIndex` voi `totalChunkSpan`.
4. Sua keyword matching de normalize keyword va source text dong nhat.

Ket qua mong doi:

- Chunk scoring on dinh hon.
- Khong con output/prompt bi loi tieng Viet.
- Video dai it bi lech ve phan dau/cuoi sai.

### Phase 2: Siết parser va quality guard

1. Sua `isLowQualitySummary()` dung `normalizeForCompare()`.
2. Sua `countEmptySimplifiedLabels()` nhan dien ca nhan co dau/khong dau.
3. Dung `isMapSummaryJson()` trong `parseMapSummary()`.
4. Dung `isCollapsedSummaryJson()` trong `parseCollapsedSummary()`.
5. Them check intermediate summary qua rong de fallback som.

Ket qua mong doi:

- Output kem chat luong bi phat hien tot hon.
- Reduce khong nhan summary trung gian rong mot cach im lang.

### Phase 3: Toi uu prompt va fallback

1. Viet lai direct/map/collapse/reduce prompt bang tieng Viet co dau.
2. Tang yeu cau giu cong thuc, dieu kien, buoc giai, vi du.
3. Toi uu fallback extractive de van co summary chap nhan duoc khi AI loi.
4. Chuyen `mainTopics` fallback sang tieng Viet.

Ket qua mong doi:

- Summary cuoi de hoc lai hon.
- It lap y, it noi chung chung.
- Fallback khong qua kem so voi AI path.

### Phase 4: Don code va config

1. Xem xet bo `Map` dedupe trong `selectSummaryChunks()`.
2. Giu hoac dieu chinh `SUMMARY_CHUNK_WORD_LIMIT`, `SUMMARY_MAP_GROUP_SIZE`, `SUMMARY_MAX_MAP_GROUPS`.
3. Dam bao `SUMMARY_REDUCE_MODEL` mac dinh van la model manh cho final summary.

Ket qua mong doi:

- Code gon hon.
- Config ro rang hon.

### Phase 5: Kiem chung

1. Chay build:

```powershell
npm run build
```

2. Neu can, chay TypeScript check:

```powershell
npx tsc --noEmit --pretty false
```

3. Tao summary that cho mot video da co chunks:

```powershell
curl.exe -X POST http://localhost:3000/summaries/from-video/VIDEO_UUID
```

4. Neu can danh gia chat luong bang DeepEval:

```powershell
npm run eval:summarize:deepeval -- --video-id VIDEO_UUID --model groq:llama-3.3-70b-versatile
```

## Tieu chi hoan thanh

- Khong con chuoi mojibake trong `src/summaries`.
- Prompt tieng Viet co dau va output format van la JSON hop le.
- `scoreChunk()` tinh dung vi tri dau/cuoi dua tren `chunkIndex` goc.
- `isLowQualitySummary()` bat duoc ca `"khong du"` va `"không đủ"`.
- `countEmptySimplifiedLabels()` bat duoc nhan rong co dau va khong dau.
- `parseMapSummary()` va `parseCollapsedSummary()` khong con silently accept schema sai.
- `npm run build` pass.
- Summary thuc te co `keyPoints`, `simplifiedText`, `mainTopics` ro rang, it lap, bam nguon transcript.

## Ghi chu rui ro

- Sua prompt co dau trong file tung bi mojibake nen nen patch can than, neu context patch khong on thi thay file sach se an toan hon.
- Siết parser co the lam fallback chay nhieu hon luc dau, nhung day la hanh vi tot hon viec dua du lieu rong vao reduce.
- Groq co the gap rate limit khi chay eval; neu gap 429 nen tach eval summarize rieng va giam token judge.
