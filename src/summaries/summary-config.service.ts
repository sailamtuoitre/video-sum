import { Injectable } from '@nestjs/common';
import { SummaryConfig, SummaryMode } from './summary.types';

@Injectable()
export class SummaryConfigService {
  getConfig(): SummaryConfig {
    return {
      mode: this.getMode(),
      directMaxChunks: this.getInt('SUMMARY_DIRECT_MAX_CHUNKS', 8, 1),
      mapGroupSize: this.getInt('SUMMARY_MAP_GROUP_SIZE', 4, 1),
      maxMapGroups: this.getInt('SUMMARY_MAX_MAP_GROUPS', 10, 1),
      mapMaxTokens: this.getInt('SUMMARY_MAP_MAX_TOKENS', 700, 100),
      collapseMaxGroups: this.getInt('SUMMARY_COLLAPSE_MAX_GROUPS', 6, 2),
      collapseMaxTokens: this.getInt('SUMMARY_COLLAPSE_MAX_TOKENS', 900, 100),
      reduceMaxTokens: this.getInt('SUMMARY_REDUCE_MAX_TOKENS', 1400, 200),
      chunkWordLimit: this.getInt('SUMMARY_CHUNK_WORD_LIMIT', 180, 40),
      retryAttempts: this.getInt('SUMMARY_RETRY_ATTEMPTS', 3, 0),
      retryBaseDelayMs: this.getInt('SUMMARY_RETRY_BASE_DELAY_MS', 1200, 100),
      model: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
      baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
    };
  }

  private getMode(): SummaryMode {
    const raw = process.env.SUMMARY_MODE?.toLowerCase();
    const allowed: SummaryMode[] = ['auto', 'direct', 'mapreduce', 'fallback'];

    if (raw && allowed.includes(raw as SummaryMode)) {
      return raw as SummaryMode;
    }

    return 'auto';
  }

  private getInt(name: string, fallback: number, minimum: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(parsed, minimum);
  }
}
