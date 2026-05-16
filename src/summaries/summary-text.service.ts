import { Injectable } from '@nestjs/common';

@Injectable()
export class SummaryTextService {
  normalizeWhitespace(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  countWords(text: string): number {
    return this.normalizeWhitespace(text).split(/\s+/).filter(Boolean).length;
  }

  truncateWords(text: string, maxWords: number): string {
    const words = this.normalizeWhitespace(text).split(/\s+/).filter(Boolean);

    if (words.length <= maxWords) {
      return words.join(' ');
    }

    return words.slice(0, maxWords).join(' ') + '...';
  }

  splitSentences(text: string): string[] {
    const normalized = this.normalizeWhitespace(text);
    const sentencePattern = /[^.!?]+(?:[.!?]+|$)/g;
    const matches: string[] = normalized.match(sentencePattern) ?? [];

    return matches
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0);
  }

  normalizeForCompare(text: string): string {
    return this.normalizeWhitespace(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
