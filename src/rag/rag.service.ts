import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { loadQAChain } from '@langchain/classic/chains';
import { IngestService } from './ingest.service';

type AnswerQuestionResult = {
  status: 'done';
  answer: string;
  sources: string[];
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

  async answerQuestion(question: string): Promise<AnswerQuestionResult> {
    try {
      const vectorStore = this.ingestService.getVectorStore();

      if (!vectorStore) {
        throw new Error(
          'No transcript index is available. Ingest a video transcript first.',
        );
      }

      const groqApiKey = process.env.GROQ_API_KEY;

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
        temperature: 0.7,
        maxTokens: 1000,
      });

      const chain = loadQAChain(llm, { type: 'map_reduce' });

      // First, retrieve nearest documents from the in-memory transcript index
      const retrievedDocsWithScores =
        await vectorStore.similaritySearchWithScore(question, 4);
      const retrievedDocs = retrievedDocsWithScores.map(([doc]) => doc);

      // Then, run the Map-Reduce chain with callbacks to log LLM calls
      const result = await chain.invoke({
        input_documents: retrievedDocs,
        question: question,
      });

      const sources = Array.from(
        new Set(
          retrievedDocs.map((doc) =>
            typeof doc.metadata.source === 'string'
              ? doc.metadata.source
              : 'unknown',
          ),
        ),
      );

      return {
        status: 'done',
        answer:
          typeof result.text === 'string' ? result.text : String(result.text),
        sources,
      };
    } catch (error) {
      console.error('Error during answer processing:', error);
      throw error;
    }
  }
}
