import { Injectable } from '@nestjs/common';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { IngestService } from './ingest.service';
import { getTrimmedEnv } from '../config/env';

export type RagContextChunk = {
  id?: string;
  content: string;
  chunkIndex?: number | null;
  tokenCount?: number | null;
  startChar?: number | null;
  endChar?: number | null;
  videoId?: string | null;
  projectId?: string | null;
  source?: string | null;
  score?: number;
  cosineScore?: number;
  keywordScore?: number;
};

type AnswerQuestionResult = {
  status: 'done';
  answer: string;
  sources: string[];
  retrievedChunks: RagContextChunk[];
};

@Injectable()
export class RagService {
  constructor(private readonly ingestService: IngestService) {}

  async ingestTranscriptText(
    text: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ) {
    return this.ingestService.ingestText(text, metadata);
  }

  async processLinksAndAnswerQuestion(urls: string[], question: string) {
    try {
      // 1. Ingest data
      await this.ingestService.ingest(urls);

      // 2. Answer question
      return await this.answerQuestion(question);
    } catch (error) {
      console.error('Error during QA processing:', error);
      throw error;
    }
  }

  async answerQuestion(
    question: string,
    contextChunks?: RagContextChunk[],
  ): Promise<AnswerQuestionResult> {
    try {
      const groqApiKey = getTrimmedEnv('GROQ_API_KEY');

      if (!groqApiKey) {
        throw new Error(
          'GROQ_API_KEY is required to answer questions with Groq.',
        );
      }

      const llm = new ChatOpenAI({
        model: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
        apiKey: groqApiKey,
        configuration: {
          baseURL:
            process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        },
        temperature: 0,
        maxTokens: 350,
      });

      const retrievedChunks =
        contextChunks !== undefined
          ? contextChunks.slice(0, 4)
          : await this.retrieveFromVectorStore(question);
      const answer = await this.answerFromContext(
        llm,
        question,
        retrievedChunks,
      );
      const sources = this.getSources(retrievedChunks);

      return {
        status: 'done',
        answer,
        sources,
        retrievedChunks,
      };
    } catch (error) {
      console.error('Error during answer processing:', error);
      throw error;
    }
  }

  private async retrieveFromVectorStore(
    question: string,
  ): Promise<RagContextChunk[]> {
    const vectorStore = this.ingestService.getVectorStore();

    if (!vectorStore) {
      throw new Error(
        'No transcript index is available. Ingest a video transcript first.',
      );
    }

    const retrievedDocsWithScores = await vectorStore.similaritySearchWithScore(
      question,
      4,
    );

    return retrievedDocsWithScores.map(([doc, score], index) => ({
      content: doc.pageContent,
      source:
        typeof doc.metadata.source === 'string'
          ? doc.metadata.source
          : 'vector_store',
      score,
      cosineScore: score,
      keywordScore: 0,
      chunkIndex:
        typeof doc.metadata.chunkIndex === 'number'
          ? doc.metadata.chunkIndex
          : index,
      videoId:
        typeof doc.metadata.videoId === 'string' ? doc.metadata.videoId : null,
    }));
  }

  private async answerFromContext(
    llm: ChatOpenAI,
    question: string,
    retrievedChunks: RagContextChunk[],
  ): Promise<string> {
    const context = this.formatContext(retrievedChunks);

    if (!context) {
      return 'Không có đủ bằng chứng trong transcript để trả lời câu hỏi này.';
    }

    const response = await llm.invoke([
      new SystemMessage(this.buildQaSystemPrompt()),
      new HumanMessage(this.buildQaUserPrompt(context, question)),
    ]);

    return this.extractMessageText(response.content).trim();
  }

  private buildQaSystemPrompt(): string {
    return `Bạn là trợ lý QA cho bài học toán.

Chỉ sử dụng CONTEXT được cung cấp. Không suy đoán ngoài transcript.
Trả lời thẳng vào câu hỏi trong tối đa 4 câu hoặc 4 gạch đầu dòng.
Không lặp lại câu hỏi. Không viết lời mở đầu.
Nếu câu hỏi hỏi công thức, đưa công thức trước.
Không tự thêm ví dụ, không giải thêm bài khác nếu người dùng không yêu cầu.
Nếu câu hỏi hỏi các bước, chỉ liệt kê các bước cần làm; không thêm ví dụ số.
Không đưa công thức không xuất hiện trong CONTEXT.
Nếu CONTEXT không có đủ bằng chứng, trả lời đúng câu sau: "Không có đủ bằng chứng trong transcript để trả lời câu hỏi này."
Ưu tiên tiếng Việt. Khi có thể, thêm dấu nguồn ngắn như [chunk 3].`;
  }

  private buildQaUserPrompt(context: string, question: string): string {
    return `CONTEXT:
${context}

QUESTION:
${question}

ANSWER:`;
  }

  private formatContext(chunks: RagContextChunk[]): string {
    return chunks
      .map((chunk, index) => {
        const chunkLabel =
          typeof chunk.chunkIndex === 'number' ? chunk.chunkIndex : index + 1;
        return `[chunk ${chunkLabel}] ${chunk.content.trim()}`;
      })
      .filter((entry) => entry.length > 0)
      .join('\n\n');
  }

  private getSources(chunks: RagContextChunk[]): string[] {
    return Array.from(
      new Set(chunks.map((chunk) => chunk.source ?? 'chunk').filter(Boolean)),
    );
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
}

