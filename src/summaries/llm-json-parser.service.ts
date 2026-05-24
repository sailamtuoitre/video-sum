import { Injectable } from '@nestjs/common';
import { SummaryTextService } from './summary-text.service';
import {
  CollapsedSummary,
  MapSummary,
  SourceChunk,
  SummaryJson,
} from './summary.types';

@Injectable()
export class LlmJsonParser {
  constructor(private readonly text: SummaryTextService) {}

  parseSummaryJson(content: string): SummaryJson {
    const parsed = this.parseJsonObject(content);

    if (!this.isSummaryJson(parsed)) {
      throw new Error('AI summary response does not match expected schema.');
    }

    return {
      keyPoints: this.cleanStringArray(parsed.keyPoints, 6),
      simplifiedText: this.text.normalizeWhitespace(parsed.simplifiedText),
      mainTopics: this.cleanStringArray(parsed.mainTopics, 10),
    };
  }

  parseMapSummary(
    content: string,
    fallback: {
      groupIndex: number;
      chunks: SourceChunk[];
    },
  ): MapSummary {
    let record: Record<string, unknown> | null = null;

    try {
      const parsed = this.parseJsonObject(content);
      record = this.asRecord(parsed);
    } catch {
      // JSON parse failed entirely — use all fallbacks below
    }

    return {
      groupIndex: this.cleanNumber(record?.groupIndex, fallback.groupIndex),
      sourceChunkIndexes: this.cleanNumberArray(
        this.asArray(record?.sourceChunkIndexes),
        fallback.chunks.map((chunk) => chunk.chunkIndex),
      ),
      keyIdeas: this.cleanStringArray(this.asArray(record?.keyIdeas), 8),
      importantFormulas: this.cleanStringArray(
        this.asArray(record?.importantFormulas),
        8,
      ),
      solutionSteps: this.cleanStringArray(
        this.asArray(record?.solutionSteps),
        10,
      ),
      missingInformation: this.cleanStringArray(
        this.asArray(record?.missingInformation),
        6,
      ),
    };
  }

  parseCollapsedSummary(
    content: string,
    fallbackGroup: MapSummary[],
  ): CollapsedSummary {
    const parsed = this.parseJsonObject(content);

    if (!this.isCollapsedSummaryJson(parsed)) {
      throw new Error('AI collapsed summary response does not match expected schema.');
    }

    const record = this.asRecord(parsed);

    return {
      groupIndexes: this.cleanNumberArray(
        this.asArray(record?.groupIndexes),
        fallbackGroup.map((summary) => summary.groupIndex),
      ),
      sourceChunkIndexes: this.cleanNumberArray(
        this.asArray(record?.sourceChunkIndexes),
        this.uniqueNumbers(
          fallbackGroup.flatMap((summary) => summary.sourceChunkIndexes),
        ),
      ),
      keyIdeas: this.cleanStringArray(this.asArray(record?.keyIdeas), 10),
      importantFormulas: this.cleanStringArray(
        this.asArray(record?.importantFormulas),
        10,
      ),
      solutionSteps: this.cleanStringArray(
        this.asArray(record?.solutionSteps),
        12,
      ),
      missingInformation: this.cleanStringArray(
        this.asArray(record?.missingInformation),
        8,
      ),
    };
  }

  parseJsonObject(text: string): unknown {
    const candidates = this.extractJsonCandidates(text);

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as unknown;
      } catch {
        const repaired = this.repairJsonCandidate(candidate);

        if (repaired !== candidate) {
          try {
            return JSON.parse(repaired) as unknown;
          } catch {
            continue;
          }
        }
      }
    }

    throw new Error('AI response did not contain a valid JSON object.');
  }

  extractJsonCandidates(text: string): string[] {
    const balanced = this.extractBalancedJsonObjects(text);
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start !== -1 && end !== -1 && end > start) {
      const outer = text.slice(start, end + 1);

      if (!balanced.includes(outer)) {
        balanced.push(outer);
      }
    }

    return balanced;
  }

  repairJsonCandidate(candidate: string): string {
    const repaired = this.escapeControlCharactersInStrings(candidate);

    if (repaired !== candidate) {
      return repaired;
    }

    return candidate;
  }

  escapeControlCharactersInStrings(candidate: string): string {
    let output = '';
    let insideString = false;
    let isEscaped = false;

    for (let index = 0; index < candidate.length; index += 1) {
      const char = candidate[index];

      if (char === '"' && !isEscaped) {
        insideString = !insideString;
      }

      if (insideString) {
        if (char === '\\' && !isEscaped) {
          isEscaped = true;
          output += char;
          continue;
        }

        if (isEscaped) {
          isEscaped = false;
          output += char;
          continue;
        }

        const code = char.charCodeAt(0);

        if (code >= 0 && code <= 31) {
          if (char === '\n') {
            output += '\\n';
          } else if (char === '\r') {
            output += '\\r';
          } else if (char === '\t') {
            output += '\\t';
          } else {
            const hex = code.toString(16).padStart(4, '0');
            output += `\\u${hex}`;
          }
        } else {
          output += char;
        }
      } else {
        isEscaped = false;
        output += char;
      }
    }

    return output;
  }

  extractBalancedJsonObjects(text: string): string[] {
    const results: string[] = [];
    const stack: number[] = [];

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (char === '{') {
        stack.push(index);
      } else if (char === '}') {
        const start = stack.pop();

        if (start !== undefined) {
          results.push(text.slice(start, index + 1));
        }
      }
    }

    return results;
  }

  extractMessageText(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const parts: string[] = [];

      for (const item of content) {
        if (typeof item === 'string') {
          parts.push(item);
        } else if (typeof item === 'object' && item !== null) {
          if (this.isTextContentPart(item)) {
            parts.push(item.text);
          }
        }
      }

      return parts.join(' ');
    }

    return '';
  }

  isTextContentPart(value: unknown): value is { text: string } {
    if (typeof value !== 'object' || value === null) {
      return false;
    }

    const candidate = value as Record<string, unknown>;

    if (candidate.type !== 'text') {
      return false;
    }

    return typeof candidate.text === 'string';
  }

  isSummaryJson(value: unknown): value is {
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

  isMapSummaryJson(value: unknown): value is {
    groupIndex: unknown;
    sourceChunkIndexes: unknown[];
    keyIdeas: unknown[];
    importantFormulas: unknown[];
    solutionSteps: unknown[];
    missingInformation: unknown[];
  } {
    // parseMapSummary no longer uses this validator to throw —
    // kept for type-narrowing compatibility only.
    return typeof value === 'object' && value !== null;
  }

  isCollapsedSummaryJson(value: unknown): value is {
    groupIndexes: unknown[];
    sourceChunkIndexes: unknown[];
    keyIdeas: unknown[];
    importantFormulas: unknown[];
    solutionSteps: unknown[];
    missingInformation: unknown[];
  } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'groupIndexes' in value &&
      Array.isArray(value.groupIndexes) &&
      'sourceChunkIndexes' in value &&
      Array.isArray(value.sourceChunkIndexes) &&
      'keyIdeas' in value &&
      Array.isArray(value.keyIdeas) &&
      'importantFormulas' in value &&
      Array.isArray(value.importantFormulas) &&
      'solutionSteps' in value &&
      Array.isArray(value.solutionSteps) &&
      'missingInformation' in value &&
      Array.isArray(value.missingInformation)
    );
  }

  private cleanStringArray(values: unknown[], limit: number): string[] {
    return values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => this.text.normalizeWhitespace(value))
      .filter((value) => value.length > 0)
      .slice(0, limit);
  }

  private cleanNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private cleanNumberArray(values: unknown[], fallback: number[]): number[] {
    const clean = values.filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );

    return clean.length > 0 ? this.uniqueNumbers(clean) : fallback;
  }

  private uniqueNumbers(values: number[]): number[] {
    return [...new Set(values)].sort((left, right) => left - right);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
}
