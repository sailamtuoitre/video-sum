import { Injectable } from '@nestjs/common';
import { SummaryTextService } from './summary-text.service';
import { SourceChunk, SummaryConfig } from './summary.types';

export const MATH_KEYWORDS = [
  'bài toán',
  'công thức',
  'điều kiện',
  'giải',
  'kết luận',
  'phương trình',
  'ví dụ',
  'đạo hàm',
  'tích phân',
  'hình học',
  'xác suất',
  'hệ phương trình',
] as const;

@Injectable()
export class ChunkSelector {
  constructor(private readonly text: SummaryTextService) {}

  selectSummaryChunks(
    chunks: SourceChunk[],
    config: SummaryConfig,
  ): SourceChunk[] {
    const cleanChunks = this.cleanChunks(chunks);
    const maxChunks = config.mapGroupSize * config.maxMapGroups;
    const totalChunkSpan =
      Math.max(...cleanChunks.map((chunk) => chunk.chunkIndex)) + 1;

    if (cleanChunks.length <= maxChunks) {
      return cleanChunks;
    }

    const windowSize = Math.max(1, Math.ceil(cleanChunks.length / maxChunks));
    const selected: SourceChunk[] = [];

    // Pre-score all chunks once to save CPU time
    const scoredChunks = cleanChunks.map((chunk) => ({
      chunk,
      score: this.scoreChunk(chunk, totalChunkSpan),
    }));

    for (let start = 0; start < scoredChunks.length; start += windowSize) {
      const window = scoredChunks.slice(start, start + windowSize);
      let bestItem: { chunk: SourceChunk; score: number } | undefined;

      for (const item of window) {
        if (
          !bestItem ||
          item.score > bestItem.score ||
          (item.score === bestItem.score &&
            item.chunk.chunkIndex < bestItem.chunk.chunkIndex)
        ) {
          bestItem = item;
        }
      }

      if (bestItem) {
        selected.push(bestItem.chunk);
      }
    }

    return selected
      .sort((left, right) => left.chunkIndex - right.chunkIndex)
      .slice(0, maxChunks);
  }

  scoreChunk(chunk: SourceChunk, totalChunks: number): number {
    const normalized = this.text.normalizeForCompare(chunk.content);
    let score = 0;

    if (chunk.chunkIndex <= 1) {
      score += 4;
    }

    if (chunk.chunkIndex >= totalChunks - 2) {
      score += 3;
    }

    if (/[=+\-*/^<>]|\d/.test(chunk.content)) {
      score += 4;
    }

    for (const keyword of MATH_KEYWORDS) {
      if (normalized.includes(this.text.normalizeForCompare(keyword))) {
        score += 2;
      }
    }

    const wordCount = this.text.countWords(chunk.content);

    if (wordCount >= 40 && wordCount <= 220) {
      score += 2;
    }

    return score;
  }

  cleanChunks(chunks: SourceChunk[]): SourceChunk[] {
    return chunks
      .map((chunk) => ({
        ...chunk,
        content: this.text.normalizeWhitespace(chunk.content),
      }))
      .filter((chunk) => chunk.content.length > 0);
  }

  groupChunks(chunks: SourceChunk[], groupSize: number) {
    return this.groupItems(chunks, groupSize);
  }

  groupItems<T>(items: T[], groupSize: number): T[][] {
    const groups: T[][] = [];

    for (let index = 0; index < items.length; index += groupSize) {
      groups.push(items.slice(index, index + groupSize));
    }

    return groups;
  }
}
