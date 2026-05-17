import { Injectable } from '@nestjs/common';
import { CollapsedSummary, MapSummary, SourceChunk } from './summary.types';
import { SummaryTextService } from './summary-text.service';

@Injectable()
export class SummaryPromptBuilder {
  constructor(private readonly text: SummaryTextService) {}

  buildDirectSummaryPrompt(chunks: SourceChunk[], chunkWordLimit: number) {
    return `${this.systemRules()}

Nhiem vu DIRECT:
- Tom tat truc tiep toan bo SOURCE_CHUNKS thanh ghi chu hoc toan de on tap.
- Giu cong thuc, dieu kien ap dung, dang bai, vi du, buoc giai va ket luan quan trong.
- Uu tien noi dung co can cu tu chunk, gan dau nguon nhu [chunk 3] trong tung y neu co the.
- Neu transcript thieu du kien, noi ro du kien nao con thieu.
- Moi keyPoint phai co dau nguon [chunk n] neu y do co can cu trong SOURCE_CHUNKS.
- simplifiedText chi ghi nhan muc khi co noi dung; khong viet nhan muc rong hoac nhan muc chi co "...".

Chi tra ve mot JSON object hop le, khong markdown, khong text ngoai JSON:
{
  "keyPoints": [
    "3 den 6 y chinh, moi y neu ro kien thuc/dang bai/cong thuc/buoc giai va kem [chunk n] neu co can cu"
  ],
  "simplifiedText": "Chu de bai hoc: ...\\nKien thuc trong tam: ...\\nCong thuc/dinh nghia: ...\\nDang bai va cach nhan dien: ...\\nCac buoc giai: ...\\nVi du trong transcript: ...\\nLuu y/dieu kien: ...\\nKet luan: ...\\nPhan chua du du kien: ...",
  "mainTopics": ["3 den 10 chu de, dang bai, cong thuc hoac ky nang"]
}

SOURCE_CHUNKS:
${this.formatChunks(chunks, chunkWordLimit)}`;
  }

  buildMapSummaryPrompt(
    groupIndex: number,
    chunks: SourceChunk[],
    chunkWordLimit: number,
  ) {
    return `${this.systemRules()}

Nhiem vu MAP:
- Chi phan tich nhom chunk ben duoi, khong tao final summary.
- Trich y chinh theo goc nhin hoc toan: khai niem, cong thuc, dieu kien, dang bai, buoc giai, loi can tranh.
- Moi y nen giu dau nguon nhu [chunk 3] neu co the.
- Khong them kien thuc ngoai SOURCE_CHUNKS.
- Neu nhom chunk khong du de ket luan cong thuc/dieu kien, dua vao missingInformation thay vi suy doan.

Chi tra ve mot JSON object hop le, khong markdown, khong text ngoai JSON:
{
  "groupIndex": ${groupIndex},
  "sourceChunkIndexes": [${chunks.map((chunk) => chunk.chunkIndex).join(', ')}],
  "keyIdeas": [],
  "importantFormulas": [],
  "solutionSteps": [],
  "missingInformation": []
}

SOURCE_CHUNKS:
${this.formatChunks(chunks, chunkWordLimit)}`;
  }

  buildCollapseSummaryPrompt(
    batchIndex: number,
    summaries: Array<MapSummary | CollapsedSummary>,
  ) {
    return `${this.systemRules()}

Nhiem vu COLLAPSE:
- Nen cac map summaries thanh mot summary trung gian ngan hon, khong tao final summary.
- Loai y trung lap nhung khong bo cong thuc, dieu kien, dang bai hoac buoc giai quan trong.
- Gop cac y theo nhom: keyIdeas, importantFormulas, solutionSteps, missingInformation.
- Giu lai groupIndexes va sourceChunkIndexes de truy vet nguon.
- Khong them y moi khong co trong MAP_SUMMARIES.

Chi tra ve mot JSON object hop le, khong markdown, khong text ngoai JSON:
{
  "groupIndexes": [],
  "sourceChunkIndexes": [],
  "keyIdeas": [],
  "importantFormulas": [],
  "solutionSteps": [],
  "missingInformation": []
}

COLLAPSE_BATCH: ${batchIndex}
MAP_SUMMARIES:
${this.formatIntermediateSummaries(summaries)}`;
  }

  buildReduceSummaryPrompt(summaries: Array<MapSummary | CollapsedSummary>) {
    return `${this.systemRules()}

Nhiem vu REDUCE:
- Gop cac summary trung gian thanh final summary dung de hoc va on tap mon toan.
- Chi dung thong tin trong INTERMEDIATE_SUMMARIES.
- Loai trung lap, giu mach bai hoc, uu tien cong thuc, dang bai, dieu kien, buoc giai va ly do cua tung buoc.
- Neu thong tin khong du de ket luan, ghi ro khong du du kien.
- Moi keyPoint phai co [chunk n] neu nguon trung gian co sourceChunkIndexes lien quan.
- Khong viet nhan muc rong trong simplifiedText; thong tin thieu phai gom vao "Phan chua du du kien".

Bat buoc viet simplifiedText theo dung cac nhan muc sau neu co thong tin:
Chu de bai hoc:
Kien thuc trong tam:
Cong thuc/dinh nghia:
Dang bai va cach nhan dien:
Cac buoc giai:
Vi du trong transcript:
Luu y/dieu kien:
Ket luan:
Phan chua du du kien:

Chi tra ve mot JSON object hop le, khong markdown, khong text ngoai JSON:
{
  "keyPoints": [
    "3 den 6 y chinh, moi y neu ro kien thuc/dang bai/cong thuc/buoc giai va kem [chunk n] neu co can cu"
  ],
  "simplifiedText": "Chu de bai hoc: ...\\nKien thuc trong tam: ...\\nCong thuc/dinh nghia: ...\\nDang bai va cach nhan dien: ...\\nCac buoc giai: ...\\nVi du trong transcript: ...\\nLuu y/dieu kien: ...\\nKet luan: ...\\nPhan chua du du kien: ...",
  "mainTopics": ["3 den 10 chu de, dang bai, cong thuc hoac ky nang"]
}

INTERMEDIATE_SUMMARIES:
${this.formatIntermediateSummaries(summaries)}`;
  }

  private systemRules() {
    return `Ban la he thong tom tat noi dung hoc toan co do chinh xac cao.

Quy tac bat buoc:
1. Khong suy doan ngoai du lieu duoc cung cap.
2. Khong tu tao dinh ly, cong thuc, so lieu hoac dieu kien khong co trong nguon.
3. Neu thieu du kien, phai noi ro du kien nao con thieu.
4. Voi bai giai toan, giu cac buoc bien doi quan trong va ly do cua tung buoc.
5. Neu khong du do tin cay, ghi: "Khong du do tin cay de khang dinh buoc nay."
6. JSON phai parse duoc bang JSON.parse: dung double quotes, khong trailing comma, khong code fence.
7. Khong boc markdown, khong them giai thich ngoai JSON.
8. Moi y quan trong phai giu dau nguon [chunk n] khi co the truy vet.
9. Neu khong co thong tin cho mot nhan muc, bo nhan muc do hoac ghi vao "Phan chua du du kien" thay vi dien noi dung rong.`;
  }

  private formatChunks(chunks: SourceChunk[], chunkWordLimit: number) {
    return chunks
      .map((chunk) => {
        const content = this.text.truncateWords(chunk.content, chunkWordLimit);
        return `[chunk ${chunk.chunkIndex}] ${content}`;
      })
      .join('\n\n');
  }

  private formatIntermediateSummaries(
    summaries: Array<MapSummary | CollapsedSummary>,
  ) {
    return summaries
      .map((summary, index) => JSON.stringify({ index, ...summary }))
      .join('\n');
  }
}
