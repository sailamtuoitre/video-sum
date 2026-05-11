import { Injectable, NotFoundException } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { Prisma } from '@prisma/client';
import { ChunkService } from '../chunks/chunk.service';
import { PrismaService } from '../prisma/prisma.service';

type SourceChunk = {
  id?: string;
  videoId: string;
  transcriptId: string;
  content: string;
  chunkIndex: number;
  tokenCount: number | null;
  startChar: number | null;
  endChar: number | null;
};

type SummaryDraft = {
  keyPoints: string[];
  simplifiedText: string;
  mainTopics: string[];
  modelUsed: string;
  sourceChunkCount: number;
  sourceWordCount: number;
};

@Injectable()
export class SummaryService {
  private readonly sentenceLimit = 180;
  private readonly chunkWordLimit = 180;
  private readonly sectionSize = 4;
  private readonly aiSummaryMaxChars = 12000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
  ) {}

  findAll(videoId?: string) {
    return this.prisma.summary.findMany({
      where: videoId ? { videoId } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const summary = await this.prisma.summary.findUnique({
      where: {
        id,
      },
    });

    if (!summary) {
      throw new NotFoundException(`Summary with id "${id}" not found`);
    }

    return summary;
  }

  async createFromVideo(videoId: string) {
    const video = await this.prisma.video.findUnique({
      where: {
        id: videoId,
      },
      select: {
        id: true,
      },
    });

    if (!video) {
      throw new NotFoundException(`Video with id "${videoId}" not found`);
    }

    const transcript = await this.prisma.transcript.findFirst({
      where: {
        videoId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!transcript) {
      throw new NotFoundException(
        `Transcript for video with id "${videoId}" not found`,
      );
    }

    const sourceChunks = await this.loadSourceChunks({
      videoId,
      transcriptId: transcript.id,
      rawText: transcript.rawText,
    });
    const fallbackDraft = this.buildSummaryDraft(sourceChunks);
    const draft = await this.buildAiSummaryDraft(sourceChunks, fallbackDraft);

    return this.prisma.summary.upsert({
      where: {
        videoId,
      },
      create: {
        videoId,
        keyPoints: draft.keyPoints,
        simplifiedText: draft.simplifiedText,
        mainTopics: draft.mainTopics,
        modelUsed: draft.modelUsed,
        promptTokens: draft.sourceWordCount,
        completionTokens: this.countWords(
          [draft.simplifiedText, ...draft.keyPoints, ...draft.mainTopics].join(
            ' ',
          ),
        ),
      },
      update: {
        keyPoints: draft.keyPoints,
        simplifiedText: draft.simplifiedText,
        mainTopics: draft.mainTopics,
        modelUsed: draft.modelUsed,
        promptTokens: draft.sourceWordCount,
        completionTokens: this.countWords(
          [draft.simplifiedText, ...draft.keyPoints, ...draft.mainTopics].join(
            ' ',
          ),
        ),
      },
    });
  }

  async remove(id: string) {
    try {
      return await this.prisma.summary.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException(`Summary with id "${id}" not found`);
      }

      throw error;
    }
  }

  private async loadSourceChunks(input: {
    videoId: string;
    transcriptId: string;
    rawText: string;
  }): Promise<SourceChunk[]> {
    const chunks = await this.chunkService.ensureTranscriptChunks(
      input.videoId,
      input.transcriptId,
      input.rawText,
    );

    return chunks.map((chunk) => ({
      id: chunk.id,
      videoId: chunk.videoId,
      transcriptId: chunk.transcriptId,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    }));
  }

  private buildSummaryDraft(chunks: SourceChunk[]): SummaryDraft {
    const cleanChunks = chunks
      .map((chunk) => ({
        ...chunk,
        content: this.normalizeWhitespace(chunk.content),
      }))
      .filter((chunk) => chunk.content.length > 0);

    if (cleanChunks.length === 0) {
      throw new NotFoundException('No transcript content found for summary');
    }

    const digests = cleanChunks.map((chunk) => ({
      chunk,
      digest: this.buildChunkDigest(chunk.content),
    }));
    const sectionSummaries = this.buildSectionSummaries(
      digests.map((item) => item.digest),
    );
    const keyPoints = this.extractKeyPoints([
      ...sectionSummaries,
      ...digests.map((item) => item.digest),
    ]);
    const simplifiedText = this.buildSimplifiedText(
      sectionSummaries,
      keyPoints,
    );
    const mainTopics = this.extractMainTopics(
      cleanChunks.map((chunk) => chunk.content).join(' '),
    );

    return {
      keyPoints,
      simplifiedText,
      mainTopics,
      modelUsed: 'hierarchical-extractive-v2',
      sourceChunkCount: cleanChunks.length,
      sourceWordCount: this.countWords(
        cleanChunks.map((chunk) => chunk.content).join(' '),
      ),
    };
  }

  private async buildAiSummaryDraft(
    chunks: SourceChunk[],
    fallbackDraft: SummaryDraft,
  ): Promise<SummaryDraft> {
    const groqApiKey = process.env.GROQ_API_KEY;

    if (!groqApiKey) {
      return fallbackDraft;
    }

    try {
      const model = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
      const llm = new ChatOpenAI({
        model,
        apiKey: groqApiKey,
        configuration: {
          baseURL:
            process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        },
        temperature: 0.1,
        maxTokens: 1400,
      });

      const response = await llm.invoke(this.buildMathSummaryPrompt(chunks));
      const parsed = this.parseAiSummaryContent(
        this.extractMessageText(response.content),
      );

      return {
        ...fallbackDraft,
        keyPoints: parsed.keyPoints,
        simplifiedText: parsed.simplifiedText,
        mainTopics: parsed.mainTopics,
        modelUsed: `groq:${model}:math-summary-v1`,
      };
    } catch (error) {
      console.error(
        'AI summary failed. Falling back to extractive summary:',
        error,
      );
      return fallbackDraft;
    }
  }

  private buildMathSummaryPrompt(chunks: SourceChunk[]): string {
    const evidence = this.buildChunkEvidence(chunks);

    return `Bạn là một hệ thống tóm tắt nội dung học toán có độ chính xác cao.

Nhiệm vụ:
- Tóm tắt nội dung transcript theo đúng dữ kiện trong SOURCE_CHUNKS.
- Nếu transcript có bài giải toán, hãy giữ lại các bước biến đổi quan trọng và lý do của từng bước.
- Nếu transcript chỉ là giảng bài/lý thuyết, hãy tóm tắt khái niệm, công thức, điều kiện áp dụng và ví dụ được nêu.

Quy tắc bắt buộc:
1. Không được suy đoán.
2. Nếu thiếu dữ kiện, phải nói rõ dữ kiện nào còn thiếu.
3. Chỉ sử dụng công thức/toán lý đã được chứng minh hoặc chuẩn hóa.
4. Mỗi bước biến đổi phải ghi rõ lý do nếu transcript có bài giải.
5. Không bỏ qua bước tính quan trọng được nêu trong transcript.
6. Sau khi tóm tắt bài giải, phải nêu phần kiểm tra lại kết quả, thay ngược vào đề nếu transcript có dữ kiện, và xác minh điều kiện xác định.
7. Nếu transcript nêu nhiều cách giải, hãy liệt kê ngắn gọn, chọn cách tối ưu và giải thích vì sao.
8. Nếu không chắc chắn ở bước nào, phải ghi: "Không đủ độ tin cậy để khẳng định bước này."

Định dạng nội dung trong simplifiedText:
- Phân tích đề bài
- Điều kiện/giả thiết
- Công thức sử dụng
- Giải từng bước
- Kiểm tra kết quả
- Kết luận cuối cùng

Không được tạo ra định lý, công thức hoặc dữ kiện không tồn tại.
Không được trả lời kiểu có vẻ, có thể đúng nếu chưa kiểm chứng.

Chỉ trả về JSON hợp lệ, không bọc markdown, không thêm giải thích ngoài JSON:
{
  "keyPoints": ["3 đến 6 ý chính, mỗi ý dựa trực tiếp trên SOURCE_CHUNKS"],
  "simplifiedText": "Bản tóm tắt tiếng Việt theo đúng các mục định dạng ở trên. Nếu mục nào thiếu dữ kiện trong transcript, ghi rõ thiếu dữ kiện.",
  "mainTopics": ["3 đến 10 chủ đề/toán dạng bài xuất hiện trong SOURCE_CHUNKS"]
}

SOURCE_CHUNKS:
${evidence}`;
  }

  private buildChunkEvidence(chunks: SourceChunk[]): string {
    const cleanChunks = chunks
      .map((chunk) => ({
        ...chunk,
        content: this.normalizeWhitespace(chunk.content),
      }))
      .filter((chunk) => chunk.content.length > 0);

    let totalChars = 0;
    const evidence: string[] = [];

    for (const chunk of cleanChunks) {
      const content = this.truncateWords(chunk.content, this.chunkWordLimit);
      const entry = `[chunk ${chunk.chunkIndex}] ${content}`;

      if (totalChars + entry.length > this.aiSummaryMaxChars) {
        break;
      }

      evidence.push(entry);
      totalChars += entry.length;
    }

    return evidence.join('\n\n');
  }

  private parseAiSummaryContent(
    content: string,
  ): Pick<SummaryDraft, 'keyPoints' | 'simplifiedText' | 'mainTopics'> {
    const jsonText = this.extractJsonObject(content);
    const parsed: unknown = JSON.parse(jsonText);

    if (!this.isSummaryJson(parsed)) {
      throw new Error(
        'AI summary response does not match the expected schema.',
      );
    }

    return {
      keyPoints: this.cleanStringArray(parsed.keyPoints, 6),
      simplifiedText: this.normalizeWhitespace(parsed.simplifiedText),
      mainTopics: this.cleanStringArray(parsed.mainTopics, 10),
    };
  }

  private extractJsonObject(text: string): string {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end === -1 || end <= start) {
      throw new Error('AI summary response did not contain a JSON object.');
    }

    return text.slice(start, end + 1);
  }

  private extractMessageText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((item) => {
          if (this.isTextContentPart(item)) {
            return item.text;
          }

          return '';
        })
        .join('\n');
    }

    return String(content);
  }

  private isTextContentPart(value: unknown): value is { text: string } {
    if (typeof value !== 'object' || value === null || !('text' in value)) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    return typeof candidate.text === 'string';
  }

  private isSummaryJson(value: unknown): value is {
    keyPoints: unknown[];
    simplifiedText: string;
    mainTopics: unknown[];
  } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'keyPoints' in value &&
      Array.isArray(value.keyPoints) &&
      'simplifiedText' in value &&
      typeof value.simplifiedText === 'string' &&
      'mainTopics' in value &&
      Array.isArray(value.mainTopics)
    );
  }

  private cleanStringArray(values: unknown[], limit: number): string[] {
    return values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => this.normalizeWhitespace(value))
      .filter((value) => value.length > 0)
      .slice(0, limit);
  }

  private buildFallbackChunks(
    rawText: string,
    metadata: {
      videoId: string;
      transcriptId: string;
    },
  ): SourceChunk[] {
    const sentences = this.splitSentences(rawText);
    const chunks: SourceChunk[] = [];
    let current: string[] = [];
    let currentWords = 0;
    let cursor = 0;

    for (const sentence of sentences) {
      const wordCount = this.countWords(sentence);
      const shouldFlush =
        current.length > 0 && currentWords + wordCount > this.chunkWordLimit;

      if (shouldFlush) {
        const content = current.join(' ');
        chunks.push({
          ...metadata,
          content,
          chunkIndex: chunks.length,
          tokenCount: currentWords,
          startChar: cursor,
          endChar: cursor + content.length,
        });
        cursor += content.length + 1;
        current = [];
        currentWords = 0;
      }

      current.push(sentence);
      currentWords += wordCount;
    }

    if (current.length > 0) {
      const content = current.join(' ');
      chunks.push({
        ...metadata,
        content,
        chunkIndex: chunks.length,
        tokenCount: currentWords,
        startChar: cursor,
        endChar: cursor + content.length,
      });
    }

    if (chunks.length > 0) {
      return chunks;
    }

    const words = this.normalizeWhitespace(rawText)
      .split(/\s+/)
      .filter(Boolean);
    for (let index = 0; index < words.length; index += this.chunkWordLimit) {
      const content = words.slice(index, index + this.chunkWordLimit).join(' ');
      chunks.push({
        ...metadata,
        content,
        chunkIndex: chunks.length,
        tokenCount: this.countWords(content),
        startChar: null,
        endChar: null,
      });
    }

    return chunks;
  }

  private buildChunkDigest(text: string): string {
    const sentences = this.splitSentences(text);
    const selected = sentences
      .filter((sentence) => this.countWords(sentence) >= 5)
      .slice(0, 2);
    const digest = selected.length > 0 ? selected.join(' ') : text;

    return this.truncateWords(digest, 48);
  }

  private buildSectionSummaries(digests: string[]): string[] {
    const summaries: string[] = [];

    for (let index = 0; index < digests.length; index += this.sectionSize) {
      const section = digests.slice(index, index + this.sectionSize);
      summaries.push(this.truncateWords(section.join(' '), this.sentenceLimit));
    }

    return summaries;
  }

  private extractKeyPoints(candidates: string[]): string[] {
    const unique = new Map<string, string>();

    for (const candidate of candidates) {
      const sentences = this.splitSentences(candidate);

      for (const sentence of sentences) {
        const clean = this.truncateWords(sentence, 36);
        const key = this.normalizeForCompare(clean);

        if (key.length >= 20 && !unique.has(key)) {
          unique.set(key, clean);
        }

        if (unique.size >= 6) {
          return [...unique.values()];
        }
      }
    }

    return [...unique.values()];
  }

  private buildSimplifiedText(
    sectionSummaries: string[],
    keyPoints: string[],
  ): string {
    const source = sectionSummaries.length > 0 ? sectionSummaries : keyPoints;
    const text = source.slice(0, 3).join(' ');

    return this.truncateWords(text, 220);
  }

  private extractMainTopics(text: string): string[] {
    const mathPhrases = this.extractMathPhrases(text);
    const words = this.normalizeForCompare(text)
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !this.stopWords.has(word));

    const frequencies = new Map<string, number>();

    for (const word of words) {
      frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
    }

    const frequentWords = [...frequencies.entries()]
      .sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      )
      .map(([word]) => word)
      .slice(0, 8);

    return [...new Set([...mathPhrases, ...frequentWords])].slice(0, 10);
  }

  private extractMathPhrases(text: string): string[] {
    const normalized = this.normalizeForCompare(text);
    const topics = [
      ['linear equation', /\b(linear equation|phuong trinh bac nhat)\b/],
      ['quadratic equation', /\b(quadratic equation|phuong trinh bac hai)\b/],
      ['system of equations', /\b(system of equations|he phuong trinh)\b/],
      ['function', /\b(function|ham so)\b/],
      ['derivative', /\b(derivative|dao ham)\b/],
      ['integral', /\b(integral|tich phan)\b/],
      ['geometry', /\b(geometry|hinh hoc)\b/],
      ['probability', /\b(probability|xac suat)\b/],
      ['statistics', /\b(statistics|thong ke)\b/],
      ['vector', /\b(vector|vec to)\b/],
    ] as const;

    return topics
      .filter(([, pattern]) => pattern.test(normalized))
      .map(([topic]) => topic);
  }

  private splitSentences(text: string): string[] {
    const normalized = this.normalizeWhitespace(text);
    const sentencePattern = /[^.!?]+(?:[.!?]+|$)/g;
    const matches: string[] = normalized.match(sentencePattern) ?? [];

    return matches
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
  }

  private truncateWords(text: string, maxWords: number): string {
    const words = this.normalizeWhitespace(text).split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) {
      return words.join(' ');
    }

    return words.slice(0, maxWords).join(' ') + '...';
  }

  private normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  private normalizeForCompare(text: string): string {
    return this.normalizeWhitespace(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private countWords(text: string): number {
    return this.normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
  }

  private readonly stopWords = new Set([
    'about',
    'after',
    'also',
    'and',
    'are',
    'because',
    'but',
    'can',
    'cho',
    'cac',
    'cach',
    'cua',
    'duoc',
    'for',
    'from',
    'hay',
    'khi',
    'la',
    'lam',
    'mot',
    'nay',
    'neu',
    'nhu',
    'not',
    'qua',
    'that',
    'the',
    'thi',
    'this',
    'trong',
    'voi',
    'you',
  ]);
}
