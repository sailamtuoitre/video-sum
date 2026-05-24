import { Injectable } from '@nestjs/common';
import { CollapsedSummary, MapSummary, SourceChunk } from './summary.types';
import { SummaryTextService } from './summary-text.service';

@Injectable()
export class SummaryPromptBuilder {
  constructor(private readonly text: SummaryTextService) {}

  buildDirectSummaryPrompt(chunks: SourceChunk[], chunkWordLimit: number) {
    return `${this.systemRules()}

Nhiệm vụ:
- Tóm tắt nội dung bài giảng thành văn bản tiếng Việt học thuật, tự nhiên và dễ học lại.
- Loại bỏ filler words, câu nói lặp, câu đệm và chi tiết không cần thiết.
- Chỉ giữ ý chính có căn cứ rõ ràng trong SOURCE_CHUNKS.
- Nếu transcript bị lỗi nhận dạng, được phép chuẩn hóa chính tả và câu văn, nhưng không được thêm ý mới.
- Nếu một ý xuất hiện nhiều lần, chỉ giữ một lần và viết gọn nhất có thể.
- Không copy nguyên văn transcript.
- Nếu không có đủ thông tin cho một mục, viết ngắn gọn rằng "không đủ dữ kiện" thay vì đoán nghĩa.

Yêu cầu định dạng bắt buộc:
1. Chủ đề chính
2. Giải thích
3. Ví dụ minh họa
4. Kết luận

Quy tắc chất lượng:
- Viết bằng văn học thuật, trang trọng, rõ nghĩa.
- Mỗi mục bắt đầu bằng một câu tổng quát, sau đó mới nêu nội dung cụ thể.
- Không lặp lại cùng một ý bằng nhiều cách khác nhau.
- Mỗi keyPoint phải là một ý độc lập, ngắn gọn, có giá trị học tập.
- simplifiedText phải đi thẳng vào nội dung, không có câu dẫn dông dài.
- mainTopics chỉ gồm 3 đến 8 chủ đề hoặc khía cạnh quan trọng nhất.

Chỉ trả về một JSON object hợp lệ, không markdown, không text ngoài JSON:
{
  "keyPoints": [
    "3 đến 5 ý chính ngắn gọn, khác nhau, bám sát transcript"
  ],
  "simplifiedText": "1. Chủ đề chính: ...\\n2. Giải thích: ...\\n3. Ví dụ minh họa: ...\\n4. Kết luận: ...",
  "mainTopics": ["3 đến 8 chủ đề, khía cạnh hoặc khung kiến thức quan trọng"]
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

Nhiệm vụ MAP:
- Chỉ phân tích nhóm chunk bên dưới, chưa viết final summary.
- Rút ra ý chính, khía cạnh, định nghĩa, công thức, điều kiện, cách làm, ví dụ và lỗi nhận dạng nếu có.
- Ưu tiên ý có căn cứ rõ ràng; có thể gắn nhãn [chunk n] nếu thật sự cần truy vết.
- Không thêm kiến thức bên ngoài SOURCE_CHUNKS.
- Không lặp lại cùng một ý ở nhiều mảng khác nhau.
- Nếu thông tin không đủ để kết luận, đưa vào missingInformation thay vì suy đoán.
- Văn phong cần gọn, rõ, ít trùng lặp.

Chỉ trả về một JSON object hợp lệ, không markdown, không text ngoài JSON:
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

Nhiệm vụ COLLAPSE:
- Rút gọn các map summaries thành summary trung gian ngắn hơn.
- Gộp ý trùng lặp, nhưng không được làm mất công thức, điều kiện, cách làm, ví dụ hoặc ý then chốt.
- Giữ liên kết nguồn qua groupIndexes và sourceChunkIndexes.
- Không thêm ý mới ngoài MAP_SUMMARIES.
- Ưu tiên nội dung có giá trị tổng hợp và có thể dùng để viết bản tóm tắt cuối.

Chỉ trả về một JSON object hợp lệ, không markdown, không text ngoài JSON:
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

Nhiệm vụ REDUCE:
- Tổng hợp INTERMEDIATE_SUMMARIES thành bản tóm tắt cuối cùng có thể học lại nhanh.
- Chỉ dùng thông tin có sẵn trong INTERMEDIATE_SUMMARIES.
- Gộp ý trùng lặp, ưu tiên ý quan trọng nhất và bỏ chi tiết lan man.
- Giữ lại công thức, điều kiện áp dụng, ví dụ và các bước giải nếu chúng xuất hiện trong nguồn trung gian.
- Tạo văn bản có văn phong học thuật, trong sáng, không lặp câu, không nối từ dư thừa.
- Cuối cùng phải ra đúng cấu trúc:
  1. Chủ đề chính
  2. Giải thích
  3. Ví dụ minh họa
  4. Kết luận
- Nếu một mục không đủ thông tin, viết ngắn gọn rằng "không đủ dữ kiện".
- Mỗi keyPoint phải ngắn, rõ và không trùng nhau.
- mainTopics phải gồm 3 đến 8 ý hoặc chủ đề có giá trị tổng hợp.

Chỉ trả về một JSON object hợp lệ, không markdown, không text ngoài JSON:
{
  "keyPoints": [
    "3 đến 5 ý chính ngắn gọn, khác nhau, bám sát nội dung tổng hợp"
  ],
  "simplifiedText": "1. Chủ đề chính: ...\\n2. Giải thích: ...\\n3. Ví dụ minh họa: ...\\n4. Kết luận: ...",
  "mainTopics": ["3 đến 8 chủ đề, khía cạnh hoặc khung kiến thức quan trọng"]
}

INTERMEDIATE_SUMMARIES:
${this.formatIntermediateSummaries(summaries)}`;
  }

  private systemRules() {
    return `Bạn là hệ thống tóm tắt nội dung bài giảng có độ chính xác cao.

Quy tắc bắt buộc:
1. Chỉ sử dụng thông tin có trong SOURCE_CHUNKS hoặc INTERMEDIATE_SUMMARIES.
2. Không suy đoán, không thêm kiến thức ngoài nguồn.
3. Không copy nguyên văn transcript; phải chuyển thành văn viết tự nhiên.
4. Loại bỏ filler words, câu nói lặp và đoạn thừa.
5. Ưu tiên câu ngắn, rõ, học thuật và dễ ôn lại.
6. Nếu có nhiều ý giống nhau, gộp thành một ý duy nhất.
7. Nếu một mục không đủ dữ liệu, viết rõ "không đủ dữ kiện" thay vì bỏ trống hoặc đoán nghĩa.
8. JSON phải parse được bởi JSON.parse: dùng dấu nháy kép, không trailing comma, không code fence.
9. Không markdown, không giải thích ngoài JSON.
10. Hạn chế lặp từ và lặp câu; mỗi ý chỉ nên xuất hiện một lần nếu có thể.`;
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
