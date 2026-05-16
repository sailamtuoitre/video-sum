# Ke hoach chinh sua module summarize

## 1. Muc tieu

Nang cap module `summaries` de tao tom tat chinh xac hon cho video hoc toan, dua tren ky thuat MapReduce summarize nhung khong phu thuoc AWS Bedrock hoac model tra phi.

Huong chinh:

- Su dung chunks da luu trong database lam nguon bang chung.
- Dung model free hoac free-tier, uu tien Groq vi project da co `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_BASE_URL`.
- Giam so lan goi AI de tranh het quota free.
- Giu fallback extractive hien co de he thong van chay khi khong co API key hoac AI loi.
- Them kha nang danh gia chat luong bang script DeepEval da co trong repo.

## 2. Hien trang module hien tai

File chinh:

- `src/summaries/summary.service.ts`
- `src/summaries/summary.controller.ts`
- `src/summaries/summary.module.ts`
- `prisma/schema.prisma`
- `scripts/evaluate-chat-deepeval.py`

Luồng hiện tại:

```text
POST /summaries/from-video/:videoId
-> tim video
-> tim transcript moi nhat
-> ChunkService.ensureTranscriptChunks(...)
-> build fallback summary bang hierarchical-extractive-v2
-> neu co GROQ_API_KEY thi goi Groq de tao AI summary
-> parse strict JSON
-> summary.upsert(videoId)
```

Điểm tốt hiện có:

- Đã lấy dữ liệu từ chunks thay vì transcript thô.
- Đã có fallback khi AI lỗi.
- Đã dùng strict JSON gồm `keyPoints`, `simplifiedText`, `mainTopics`.
- Đã có đường API rõ ràng: `POST /summaries/from-video/:videoId`.
- Đã có script đánh giá summary qua `npm run eval:summarize:deepeval`.

Vấn đề cần cải thiện:

- AI prompt hiện đang nhét một phần `SOURCE_CHUNKS` vào một lần gọi duy nhất.
- Với video dài, nhiều chunk phía sau có thể bị bỏ qua do giới hạn `aiSummaryMaxChars`.
- Chưa có MapReduce thật sự: chưa tóm tắt từng nhóm chunk rồi mới reduce.
- Chưa lưu rõ summary dùng những chunk nào làm bằng chứng.
- Prompt tiếng Việt trong file hiện bị lỗi encoding mojibake, cần sửa lại cho dễ bảo trì.
- Chưa có cơ chế kiểm soát chi phí/quota theo số chunk, số lần gọi model, max tokens.

## 3. Thiet ke luong moi

Luồng đề xuất:

```text
Transcript
-> Chunks da luu trong DB
-> Chon chunk hop le
-> Neu video ngan: co the goi direct summary
-> Neu video dai: MapReduce summary
   -> Map: tom tat tung nhom chunk nho
   -> Collapse: neu qua nhieu map summaries thi nen tiep
   -> Reduce: tao final summary
-> Validate JSON
-> Luu vao Summary
-> Danh gia bang DeepEval
```

### Tham chieu tu LangChain MapReduce example

Example LangChain co cac thanh phan:

```text
document_prompt
-> cach format tung document/chunk truoc khi dua vao prompt

llm_chain
-> map chain, tom tat tung document hoac tung nhom document

combine_documents_chain
-> stuff chain, nhoi cac summary trung gian vao reduce prompt

reduce_documents_chain
-> reduce chain, dieu phoi viec combine va collapse neu qua dai

collapse_documents_chain
-> buoc nen trung gian truoc final reduce khi noi dung vuot context

MapReduceDocumentsChain
-> chain tong: map -> optional collapse -> reduce
```

Trong project `video-sum`, minh khong nen copy y nguyen Python chain nay vao NestJS. Nen chuyen y tuong do thanh cac ham TypeScript trong `SummaryService`:

```text
LangChain document_prompt
-> buildChunkEvidence(...) hoac formatSummaryDocument(...)

LangChain llm_chain
-> buildMapSummaries(...)

LangChain combine_documents_chain
-> formatMapSummariesForReduce(...)

LangChain collapse_documents_chain
-> collapseMapSummaries(...)

LangChain reduce_documents_chain
-> reduceMapSummaries(...)

LangChain MapReduceDocumentsChain
-> buildMapReduceSummaryDraft(...)
```

Ly do khong nen phu thuoc truc tiep vao `MapReduceDocumentsChain`:

- Project dang dung NestJS/TypeScript, khong phai Python.
- LangChain JS/TS version va API co the khac example Python `langchain_classic`.
- Minh can control quota free-tier chat hon chain mac dinh.
- Minh can gan summary voi `chunkIndex`, `sourceChunkId`, math-specific rules va fallback rieng.
- Tu implement luong map/collapse/reduce se de debug hon trong API backend.

Ket luan: dung example de lay kien truc, nhung implement bang code noi bo trong `summary.service.ts`.

Chiến lược tiết kiệm quota:

- Không gọi AI cho từng chunk riêng lẻ nếu chunk quá nhiều.
- Gom 3-5 chunks thành một `map group`.
- Giới hạn số group tối đa trong lần đầu, ví dụ 8-12 group.
- Với video quá dài, chọn chunk theo chiến lược:
  - lấy các chunk đầu để nắm mục tiêu bài học;
  - lấy chunk có nhiều dấu hiệu toán học như công thức, biến đổi, ví dụ, kết luận;
  - lấy một số chunk cuối để giữ phần kết luận;
  - tránh chỉ lấy liên tiếp từ đầu video.
- Nếu không có `GROQ_API_KEY`, dùng fallback extractive hiện tại.

## 4. Cau truc output mong muon

Vẫn giữ contract frontend/API hiện tại:

```json
{
  "keyPoints": [],
  "simplifiedText": "",
  "mainTopics": []
}
```

Nội dung `simplifiedText` nên có cấu trúc:

```text
1. Chu de bai hoc
2. Kien thuc/cau truc chinh
3. Cong thuc hoac dinh nghia quan trong
4. Cac buoc giai hoac cach lap luan
5. Vi du neu transcript co neu
6. Dieu kien can chu y
7. Ket luan
8. Phan chua du du kien neu co
```

Với bài toán cụ thể, ưu tiên:

- giả thiết;
- công thức sử dụng;
- biến đổi từng bước;
- lý do của từng bước;
- kiểm tra điều kiện;
- kết luận cuối cùng.

## 5. Cac buoc chinh sua chi tiet

### Buoc 1: Lam sach va tach prompt

Muc tieu:

- Sửa prompt tiếng Việt bị lỗi encoding trong `summary.service.ts`.
- Tách prompt ra thành các hàm rõ ràng:
  - `buildMapSummaryPrompt(...)`
  - `buildCollapseSummaryPrompt(...)`
  - `buildReduceSummaryPrompt(...)`
  - `buildDirectSummaryPrompt(...)`

Viec can lam:

- Thay `buildMathSummaryPrompt(chunks)` bằng 3 prompt riêng.
- Giữ rule chống bịa:
  - chỉ dùng thông tin trong chunks;
  - nếu thiếu dữ kiện thì nói rõ;
  - không tự thêm công thức/định lý;
  - trả về JSON hợp lệ.
- Dùng tiếng Việt có dấu chuẩn, dễ đọc trong source.

Ket qua mong doi:

- Code dễ bảo trì.
- Prompt không còn bị mojibake.
- Dễ thay đổi từng bước Map/Reduce mà không ảnh hưởng toàn bộ service.

### Buoc 2: Tao cau hinh summarize free-tier

Muc tieu:

- Kiểm soát số lần gọi model để không tốn nhiều quota.

Them cac bien cau hinh:

```text
SUMMARY_MODE=auto
SUMMARY_DIRECT_MAX_CHUNKS=8
SUMMARY_MAP_GROUP_SIZE=4
SUMMARY_MAX_MAP_GROUPS=10
SUMMARY_MAP_MAX_TOKENS=700
SUMMARY_COLLAPSE_MAX_GROUPS=6
SUMMARY_COLLAPSE_MAX_TOKENS=900
SUMMARY_REDUCE_MAX_TOKENS=1400
SUMMARY_CHUNK_WORD_LIMIT=180
```

Y nghia:

- `SUMMARY_MODE=auto`: video ngắn dùng direct, video dài dùng MapReduce.
- `SUMMARY_DIRECT_MAX_CHUNKS`: nếu số chunk nhỏ hơn ngưỡng này thì tóm tắt một lần.
- `SUMMARY_MAP_GROUP_SIZE`: số chunk trong một lần map.
- `SUMMARY_MAX_MAP_GROUPS`: giới hạn số nhóm để tránh gọi AI quá nhiều.
- `SUMMARY_MAP_MAX_TOKENS`: giới hạn output mỗi map.
- `SUMMARY_COLLAPSE_MAX_GROUPS`: nếu số map summaries vượt ngưỡng này thì chạy collapse trước khi reduce.
- `SUMMARY_COLLAPSE_MAX_TOKENS`: giới hạn output cho mỗi lần collapse.
- `SUMMARY_REDUCE_MAX_TOKENS`: giới hạn output cuối.

Ket qua mong doi:

- Có thể chỉnh quota bằng `.env`.
- Không cần đổi code khi muốn giảm/tăng số lần gọi AI.

### Buoc 3: Chon source chunks thong minh

Muc tieu:

- Không chỉ lấy các chunk đầu tiên.
- Giữ được nội dung quan trọng trong video dài.

Them ham:

```ts
private selectSummaryChunks(chunks: SourceChunk[]): SourceChunk[]
```

Logic đề xuất:

- Chuẩn hóa nội dung chunk.
- Loại chunk rỗng hoặc quá ngắn.
- Tính điểm cho chunk:
  - có công thức, ký hiệu toán học, số, phương trình;
  - có từ khóa như "ví dụ", "bài toán", "giải", "kết luận", "điều kiện", "công thức";
  - có độ dài đủ tốt;
  - nằm ở đầu hoặc cuối video.
- Chọn tối đa `SUMMARY_MAP_GROUP_SIZE * SUMMARY_MAX_MAP_GROUPS` chunks.
- Sắp xếp lại theo `chunkIndex` trước khi đưa vào prompt để giữ mạch bài.

Ket qua mong doi:

- Video dài vẫn lấy được phần quan trọng.
- Giảm nguy cơ summary bỏ qua đoạn lời giải ở giữa/cuối video.

### Buoc 4: Cai dat Map step

Muc tieu:

- Mỗi nhóm chunk tạo ra một summary trung gian ngắn, có dẫn nguồn chunk.

Them type noi bo:

```ts
type MapSummary = {
  groupIndex: number;
  sourceChunkIndexes: number[];
  keyIdeas: string[];
  importantFormulas: string[];
  solutionSteps: string[];
  missingInformation: string[];
};
```

Them ham:

```ts
private async buildMapSummaries(
  llm: ChatOpenAI,
  chunks: SourceChunk[],
): Promise<MapSummary[]>
```

Quy tắc Map prompt:

- Chỉ tóm tắt nhóm chunks được đưa vào.
- Không tạo final summary.
- Luôn trả về JSON.
- Mỗi ý nên ghi chunk liên quan, ví dụ `[chunk 3]`.
- Nếu nhóm chunk không có nội dung học tập rõ, trả về mảng rỗng thay vì bịa.

Ket qua mong doi:

- Có nhiều summary nhỏ, mỗi summary gắn với nhóm chunk.
- Nếu một nhóm lỗi JSON, có thể fallback riêng cho nhóm đó thay vì hỏng toàn bộ.

### Buoc 4.5: Cai dat Collapse step

Muc tieu:

- Dua y tu `collapse_documents_chain` trong example LangChain vao project.
- Neu co qua nhieu `MapSummary`, nen bot truoc khi goi reduce cuoi cung.
- Giam nguy co reduce prompt vuot context hoac ton nhieu token.

Khi nao can collapse:

```text
if mapSummaries.length > SUMMARY_COLLAPSE_MAX_GROUPS:
  collapsedSummaries = collapseMapSummaries(llm, mapSummaries)
else:
  collapsedSummaries = mapSummaries
```

Them type noi bo:

```ts
type CollapsedSummary = {
  groupIndexes: number[];
  sourceChunkIndexes: number[];
  keyIdeas: string[];
  importantFormulas: string[];
  solutionSteps: string[];
  missingInformation: string[];
};
```

Them ham:

```ts
private async collapseMapSummaries(
  llm: ChatOpenAI,
  mapSummaries: MapSummary[],
): Promise<CollapsedSummary[]>
```

Quy tac Collapse prompt:

- Khong tao final summary.
- Chi nen cac map summaries bi trung lap hoac qua dai.
- Giu lai `sourceChunkIndexes` de khong mat dau vet nguon.
- Giu cong thuc, dieu kien, buoc giai quan trong.
- Neu co mau thuan giua cac map summaries, ghi vao `missingInformation` hoac noi ro chua du tin cay.

Lien he voi example:

```text
LangChain collapse_documents_chain
-> collapseMapSummaries(...)
```

Trong example, collapse duoc chay truoc final call khi tai lieu trung gian qua dai. Trong project nay, collapse nen la optional step de tiet kiem context va quota, khong bat buoc chay voi video ngan.

Ket qua mong doi:

- Reduce step nhan dau vao ngan gon hon.
- Summary cuoi cung it bi roi rac.
- Van giu duoc bang chung chunk sau khi nen.

### Buoc 5: Cai dat Reduce step

Muc tieu:

- Gộp các `MapSummary` thành output cuối cùng đúng contract hiện tại.

Them ham:

```ts
private async reduceMapSummaries(
  llm: ChatOpenAI,
  summaries: Array<MapSummary | CollapsedSummary>,
  fallbackDraft: SummaryDraft,
): Promise<SummaryDraft>
```

Quy tắc Reduce prompt:

- Chỉ dùng thông tin từ map summaries.
- Loại ý trùng lặp.
- Ưu tiên công thức, dạng bài, bước giải, điều kiện.
- Ghi rõ nếu thiếu dữ liệu.
- Trả về JSON đúng schema:

```json
{
  "keyPoints": [],
  "simplifiedText": "",
  "mainTopics": []
}
```

Ket qua mong doi:

- Final summary mạch lạc hơn.
- Không bị giới hạn chỉ bởi phần đầu transcript.
- Dễ debug vì có map summaries trung gian.

### Buoc 6: Giu direct path cho video ngan

Muc tieu:

- Tránh gọi nhiều API không cần thiết với video ngắn.

Logic:

```text
if selectedChunks.length <= SUMMARY_DIRECT_MAX_CHUNKS:
  call direct summary prompt 1 lan
else:
  call map -> optional collapse -> reduce
```

Ket qua mong doi:

- Video ngắn nhanh hơn.
- Tiết kiệm quota free.
- Video dài vẫn có chất lượng tốt hơn luồng direct hiện tại.

### Buoc 7: Tang kha nang parse va fallback

Muc tieu:

- AI free model đôi khi trả JSON không chuẩn, cần parse bền hơn.

Viec can lam:

- Giữ `extractJsonObject(...)`.
- Thêm validate riêng cho `MapSummary`.
- Nếu map group lỗi:
  - log group lỗi;
  - tạo fallback map summary từ `buildChunkDigest(...)`;
  - tiếp tục reduce.
- Nếu reduce lỗi:
  - trả về fallbackDraft.

Ket qua mong doi:

- Một lỗi nhỏ không làm hỏng toàn bộ summary.
- API vẫn trả được kết quả.

### Buoc 8: Luu metadata ve model va nguon

Muc tieu:

- Biết summary được tạo bằng direct, mapreduce hay fallback.

Khong bat buoc sua schema ngay. Truoc mat co the dung `modelUsed`:

```text
groq:llama-3.1-8b-instant:math-summary-direct-v2
groq:llama-3.1-8b-instant:math-summary-mapreduce-v1
hierarchical-extractive-v2
```

Neu muon nang cap schema sau:

- thêm `sourceChunkIds Json?`;
- thêm `summaryStrategy String?`;
- thêm `mapGroupCount Int?`;

Nhung giai đoạn đầu nên tránh migration nếu chưa cần, để giảm rủi ro.

Ket qua mong doi:

- Debug dễ hơn.
- Biết summary có thật sự dùng MapReduce hay không.

### Buoc 9: Cap nhat endpoint neu can

Endpoint hiện tại vẫn đủ dùng:

```text
POST /summaries/from-video/:videoId
GET /summaries?videoId=:videoId
GET /summaries/:id
DELETE /summaries/:id
```

Không nên đổi contract frontend ở bước đầu.

Có thể thêm query tuỳ chọn sau:

```text
POST /summaries/from-video/:videoId?strategy=direct
POST /summaries/from-video/:videoId?strategy=mapreduce
POST /summaries/from-video/:videoId?strategy=fallback
```

Nhưng chỉ thêm nếu thật sự cần test thủ công. Mặc định nên để `auto`.

### Buoc 10: Kiem thu bang build va smoke test

Sau khi sửa code:

```powershell
npm run build
```

Nếu backend đang chạy:

```powershell
curl.exe -X POST http://localhost:3000/summaries/from-video/VIDEO_ID
curl.exe http://localhost:3000/summaries?videoId=VIDEO_ID
```

Kiểm tra trong response:

- `keyPoints` không rỗng;
- `simplifiedText` có cấu trúc rõ;
- `mainTopics` đúng chủ đề toán;
- `modelUsed` cho biết direct/mapreduce/fallback;
- không có nội dung bịa ngoài transcript.

### Buoc 11: Danh gia chat luong

Dùng script hiện có:

```powershell
npm run eval:summarize:deepeval -- --model groq:llama-3.3-70b-versatile --video-id VIDEO_ID
```

Nếu muốn lưu report:

```powershell
npm run eval:summarize:deepeval -- --model groq:llama-3.3-70b-versatile --video-id VIDEO_ID --out summary-mapreduce-report.json
```

Chỉ số cần xem:

- summary có bám nguồn chunk không;
- có bỏ sót ý chính không;
- có thêm thông tin không có trong transcript không;
- có hữu ích cho học toán không.

## 6. Thu tu uu tien thuc hien

### Phase 1: An toan va nhanh

1. Sửa encoding prompt tiếng Việt.
2. Tách direct prompt ra hàm riêng.
3. Thêm config từ `.env`.
4. Giữ fallback extractive.
5. Chạy `npm run build`.

### Phase 2: MapReduce co kiem soat quota

1. Thêm `selectSummaryChunks`.
2. Thêm group chunks.
3. Thêm map prompt và parser.
4. Thêm collapse prompt và parser.
5. Thêm reduce prompt và parser.
6. Chọn direct hoặc map -> optional collapse -> reduce theo số chunk.
7. Chạy smoke test với video ngắn và video dài.

### Phase 3: Danh gia va tinh chinh

1. Chạy DeepEval summary trước khi sửa để lấy baseline nếu còn có thể.
2. Chạy DeepEval sau khi sửa.
3. So sánh report.
4. Điều chỉnh prompt và config quota.
5. Nếu cần, thêm metadata schema ở giai đoạn sau.

## 7. Rủi ro và cách xử lý

Rủi ro: Free model trả JSON lỗi.

Cách xử lý:

- parse JSON bền hơn;
- fallback từng map group;
- fallback toàn bộ reduce nếu cần.

Rủi ro: MapReduce tốn quota hơn direct summary.

Cách xử lý:

- chỉ dùng MapReduce khi video dài;
- giới hạn `SUMMARY_MAX_MAP_GROUPS`;
- nhóm nhiều chunk trong một map call;
- chọn chunk quan trọng thay vì gửi tất cả.

Rủi ro: Summary bị mất chi tiết toán.

Cách xử lý:

- prompt bắt buộc giữ công thức, điều kiện, bước giải;
- map summary có `solutionSteps`;
- reduce không được bỏ bước biến đổi quan trọng.

Rủi ro: Summary bịa kiến thức.

Cách xử lý:

- bắt buộc chỉ dùng chunk;
- yêu cầu ghi thiếu dữ kiện khi không đủ thông tin;
- đánh giá bằng DeepEval SummarizationMetric.

## 8. Tieu chi hoan thanh

Module được xem là đạt khi:

- `npm run build` thành công.
- `POST /summaries/from-video/:videoId` vẫn hoạt động.
- Video ngắn dùng direct path hoặc fallback hợp lý.
- Video dài dùng MapReduce path.
- Không cần AWS Bedrock.
- Chạy được với Groq free-tier qua `.env`.
- Summary tiếng Việt rõ ràng, có cấu trúc học toán.
- Không bỏ qua nhiều chunk quan trọng chỉ vì giới hạn prompt.
- Khi thiếu API key, hệ thống vẫn trả fallback summary.
- Có thể dùng `npm run eval:summarize:deepeval` để so sánh chất lượng.

## 9. De xuat file se can sua khi implement

Bat buoc:

- `src/summaries/summary.service.ts`

Co the can:

- `.env.example`
- `README.md`
- `scripts/chat-eval.sample.json`

Chua nen sua neu chua can:

- `prisma/schema.prisma`
- frontend contract
- `summary.controller.ts`

## 10. Ket luan

Kỹ thuật nên dùng không phải bê nguyên AWS Bedrock từ bài Medium, mà là giữ ý tưởng MapReduce:

```text
chunk -> map summary -> optional collapse -> reduce final summary
```

Sau đó điều chỉnh cho project hiện tại:

- dùng Groq/free-tier;
- giới hạn số lần gọi model;
- ưu tiên chunk có giá trị học toán;
- giữ fallback extractive;
- đo chất lượng bằng script evaluation sẵn có.

Đây là hướng phù hợp nhất với mục tiêu: chất lượng summary tốt hơn nhưng vẫn tiết kiệm tài nguyên.
