# Ke hoach cai thien chat luong RAG answer va summarize

## 1. Muc tieu

Nang diem danh gia DeepEval cho hai luong chinh:

- RAG answer: tra loi ngan, dung cau hoi, bam bang chung trong transcript chunks.
- Summarize: tom tat dung trong tam bai hoc toan, giu cong thuc/dieu kien/buoc giai, khong them thong tin ngoai nguon.

Muc tieu do duoc:

- RAG baseline: chay lai voi eval set that, khong dung `scripts/chat-eval.sample.json`.
- RAG target: average score >= 0.75 voi `answer_relevancy`, `faithfulness`, `contextual_relevancy`.
- Summary target: SummarizationMetric >= 0.75 tren cung video/eval set.
- Neu eval set co `expectedOutput` day du, bo sung `contextual_precision` va `contextual_recall`.

## 2. Hien trang va nguyen nhan diem thap

Ket qua report gan day cho thay:

- `deepeval-G-9G2nDnwqA-rag-report.json` chi dat `0.5416` vi dang dung eval sample/placeholder, cau hoi qua chung, expected output chua phai dap an that.
- `deepeval-QTkfXTLyesk-rag-report.json` dat `0.6878`, sat nguong nhung thap vi answer dai, lan man, co cong thuc sai va tu them vi du ngoai cau hoi.

Van de ky thuat can sua:

- `src/rag/rag.service.ts` dang de `temperature: 0.7`, de model sang tao qua muc voi QA toan.
- RAG dang dung `loadQAChain(..., { type: 'map_reduce' })` mac dinh, chua co prompt rieng ep tra loi ngan va bam nguon.
- `retrievedChunks` trong `ChatSessionService` duoc tinh bang keyword ranking, trong khi LLM lai dung docs tu `RagService.answerQuestion()` qua similarity search. Hai tap context co the khac nhau.
- DeepEval report hien tai chi chay `answer_relevancy`, chua du de biet loi nam o retrieval, grounding hay answer generation.
- Summary da co prompt rieng va map/reduce, nhung van can eval set that, assessment questions ro hon, va can doi chieu voi source chunks.

## 3. Phase 1 - Tao eval set that

Muc tieu:

- Bo `scripts/chat-eval.sample.json` khi danh gia that.
- Tao eval set rieng cho tung video/bai hoc.
- Moi cau hoi phai co dap an ly tuong duoc lay tu transcript/chunks.

Viec can lam:

- Tao file moi, vi du `scripts/eval-math-sphere-oxyz.json`.
- Dien `videoId` that.
- Viet 5-10 cau hoi RAG theo cac nhom:
  - cau hoi khai niem;
  - cau hoi cong thuc;
  - cau hoi dieu kien ap dung;
  - cau hoi cac buoc giai;
  - cau hoi out-of-scope de test kha nang tu choi khi khong co bang chung.
- Moi item nen co:
  - `id`;
  - `question`;
  - `expectedOutput`;
  - neu can, them `expectedKeywords` va `forbiddenKeywords` cho baseline script.
- Them `summaryAssessmentQuestions` cu the theo bai hoc.

Tieu chi dat:

- Khong con placeholder `Replace this with...`.
- Cau hoi out-of-scope phai noi ro chu de nao khong co trong video.
- `expectedOutput` dung, ngan, co cong thuc/chieu can thiet.

Vi du cau hoi tot:

```json
{
  "id": "sphere-general-form-condition",
  "question": "Dieu kien nao de x^2 + y^2 + z^2 + 2ax + 2by + 2cz + d = 0 la phuong trinh mat cau?",
  "expectedOutput": "Dieu kien la a^2 + b^2 + c^2 - d > 0. Khi do tam la I(-a, -b, -c) va ban kinh R = sqrt(a^2 + b^2 + c^2 - d)."
}
```

## 4. Phase 2 - Cai thien RAG answer

Muc tieu:

- QA toan phai tra loi dung cau hoi, khong tu them vi du.
- Neu context khong co thong tin, tra loi ro: khong co bang chung trong transcript.
- Giam hallucination cong thuc.

Viec can lam:

- Trong `src/rag/rag.service.ts`, giam `temperature` tu `0.7` xuong `0` hoac `0.1`.
- Doi `maxTokens` tu `1000` xuong khoang `500-700` cho cau tra loi ngan hon.
- Thay chain/prompt mac dinh bang prompt QA rieng cho toan.
- Prompt can co quy tac:
  - chi dung retrieved context;
  - tra loi truc tiep cau hoi;
  - neu la cong thuc, ghi dung cong thuc truoc roi moi giai thich;
  - khong tao vi du moi neu cau hoi khong yeu cau;
  - neu khong tim thay bang chung, noi khong co bang chung trong transcript;
  - uu tien tieng Viet.

Prompt khuyen nghi:

```text
Ban la tro ly QA cho bai hoc toan.

Chi su dung CONTEXT duoc cung cap. Khong suy doan ngoai transcript.
Tra loi ngan gon, dung cau hoi. Neu cau hoi hoi cong thuc, dua cong thuc truoc.
Khong tu them vi du, khong giai them bai khac neu nguoi dung khong yeu cau.
Neu CONTEXT khong co du bang chung, tra loi: "Khong co du bang chung trong transcript de tra loi cau hoi nay."

CONTEXT:
{context}

QUESTION:
{question}

ANSWER:
```

Tieu chi dat:

- Cau hoi cong thuc tra loi dung cong thuc trong 1-3 doan ngan.
- Cau hoi out-of-scope khong bi tra loi lan man.
- Khong con cac cau mo dau nhu "Toi khong hieu ro cau hoi..." khi cau hoi da ro.

## 5. Phase 3 - Dong bo retrievedChunks voi context dua vao LLM

Muc tieu:

- `retrievedChunks` trong API response phai chinh la context da dua vao model.
- DeepEval dung dung retrieval context that.

Viec can lam:

- Doi `RagService.answerQuestion()` de tra ve ca `retrievedDocsWithScores`, khong chi tra `sources`.
- Trong `ChatSessionService`, bo viec tinh `retrievedChunks` bang keyword ranking rieng neu answer dang dung vector search.
- Hoac chon mot huong ro rang:
  - Huong A: `ChatSessionService` rank chunks truoc, truyen chinh cac chunks do vao `RagService.answerQuestion(question, chunks)`.
  - Huong B: `RagService` tu retrieve va tra ve retrieved chunks that de luu vao DB.
- Uu tien Huong A vi no giu chat/session/video context ro rang hon.

Tieu chi dat:

- Report DeepEval `retrievalContextCount` van co context, va context do la dung 4 chunks dua vao LLM.
- Khi debug mot cau fail, co the doc `retrievedChunks` va giai thich vi sao answer sai.
- Khong con 2 co che retrieval song song cho cung mot request.

## 6. Phase 4 - Cai thien summarize

Muc tieu:

- Summary phai phu hop hoc toan: chu de, cong thuc, dieu kien, dang bai, buoc giai, luu y.
- Khong them cong thuc/dieu kien neu transcript khong co.
- Co the truy vet source chunk.

Viec can lam:

- Giu luong AI-first + fallback hien co trong `src/summaries`.
- Kiem tra prompt trong `src/summaries/summary-prompt.builder.ts`:
  - direct prompt;
  - map prompt;
  - collapse prompt;
  - reduce prompt.
- Them/siet quy tac neu output con lan man:
  - moi `keyPoint` nen co `[chunk n]` neu co can cu;
  - `simplifiedText` phai theo cac nhan muc co san;
  - neu thieu du kien, ghi vao "Phan chua du du kien";
  - khong viet nhan muc rong neu khong co thong tin.
- Kiem tra `summaryAssessmentQuestions` trong eval set:
  - co giu dung muc tieu bai hoc khong;
  - co giu cong thuc/dieu kien/buoc giai khong;
  - co tranh them thong tin ngoai transcript khong;
  - co ro rang cho hoc sinh on tap khong.

Tieu chi dat:

- Summary co cau truc de hoc lai, khong phai van ban dai mot cuc.
- Cong thuc quan trong khong bi mat.
- Summary khong dua kien thuc ngoai chunks.
- DeepEval summary score >= 0.75.

## 7. Phase 5 - Chay lai DeepEval va so sanh

Lenh baseline truoc khi sua:

```powershell
npm run eval:video:deepeval -- --eval-set scripts/eval-math-sphere-oxyz.json --model groq:llama-3.3-70b-versatile --metrics answer_relevancy,faithfulness,contextual_relevancy --out deepeval-before-quality-fix.json
```

Lenh sau khi sua:

```powershell
npm run eval:video:deepeval -- --eval-set scripts/eval-math-sphere-oxyz.json --model groq:llama-3.3-70b-versatile --metrics answer_relevancy,faithfulness,contextual_relevancy --out deepeval-after-quality-fix.json
```

Khi `expectedOutput` da day du cho tat ca cau hoi:

```powershell
npm run eval:rag:deepeval -- --eval-set scripts/eval-math-sphere-oxyz.json --model groq:llama-3.3-70b-versatile --metrics answer_relevancy,faithfulness,contextual_relevancy,contextual_precision,contextual_recall --out deepeval-after-full-rag-metrics.json
```

Can so sanh:

- `averageScore` tong.
- Diem tung cau hoi.
- Ly do fail cua tung metric.
- Answer co ngan hon khong.
- Answer co dung cong thuc hon khong.
- Retrieved chunks co dung source hon khong.
- Summary co giu du cong thuc/buoc giai khong.

## 8. Thu tu thuc hien de it rui ro

1. Tao eval set that va chay baseline.
2. Giam temperature + siet prompt RAG.
3. Dong bo retrievedChunks voi context that dua vao LLM.
4. Chay lai RAG metrics.
5. Siet prompt/eval cho summarize neu summary score van thap.
6. Chay `npm run build`.
7. Luu report before/after de chung minh cai thien.

## 9. Ket qua mong doi

Sau khi hoan thanh:

- RAG answer khong con tra loi lan man voi cau hoi cong thuc.
- Cau out-of-scope se tu choi dung cach thay vi doan theo.
- DeepEval report co nhieu metric hon, giup biet loi nam o retrieval hay generation.
- `retrievedChunks` tro thanh bang chung that cho ca user, debug va evaluator.
- Summary co cau truc on tap ro rang, chinh xac hon voi bai hoc toan.
