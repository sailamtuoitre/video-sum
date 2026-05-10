import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChunkService } from '../chunks/chunk.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSummaryDto } from './dto/create-summary.dto';
import { UpdateSummaryDto } from './dto/update-summary.dto';

type SummaryChunk = {
  content: string;
  chunkIndex: number;
  tokenCount?: number | null;
};

type ChunkSummary = {
  chunkIndex: number;
  text: string;
  keyPoints: string[];
  mainTopics: string[];
  tokenCount: number;
};

type SummarySection = {
  sectionIndex: number;
  chunkIndexes: number[];
  text: string;
  keyPoints: string[];
  mainTopics: string[];
  tokenCount: number;
};

type SummaryData = {
  videoId: string;
  keyPoints: string[];
  simplifiedText: string;
  mainTopics: string[];
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
};

@Injectable()
export class SummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
  ) {}

  async create(createSummaryDto: CreateSummaryDto) {
    try {
      return await this.prisma.summary.create({
        data: createSummaryDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createSummaryDto.videoId);
    }
  }

  async createFromVideo(videoId: string) {
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
        `No transcript found for video with id "${videoId}"`,
      );
    }

    const chunks = await this.loadChunksForTranscript(
      transcript.videoId,
      transcript.id,
      transcript.rawText,
    );
    const summaryData = this.buildSummaryData(videoId, chunks);

    return this.prisma.summary.upsert({
      where: {
        videoId,
      },
      create: summaryData,
      update: summaryData,
    });
  }

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

  async update(id: string, updateSummaryDto: UpdateSummaryDto) {
    try {
      return await this.prisma.summary.update({
        where: {
          id,
        },
        data: updateSummaryDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.summary.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  private async loadChunksForTranscript(
    videoId: string,
    transcriptId: string,
    rawText: string,
  ): Promise<SummaryChunk[]> {
    const chunks = await this.chunkService.ensureTranscriptChunks(
      videoId,
      transcriptId,
      rawText,
    );

    return chunks.map((chunk) => ({
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
    }));
  }

  private buildSummaryData(
    videoId: string,
    chunks: SummaryChunk[],
  ): SummaryData {
    const orderedChunks = chunks
      .slice()
      .sort((left, right) => left.chunkIndex - right.chunkIndex);
    const chunkSummaries = orderedChunks.map((chunk) =>
      this.buildChunkSummary(chunk),
    );
    const sectionSummaries = this.buildSectionSummaries(chunkSummaries);
    const finalKeyPoints = this.extractKeyPointsFromTexts(
      sectionSummaries.map((section) => section.text),
      5,
    );
    const simplifiedText = this.composeSimplifiedText(finalKeyPoints);

    return {
      videoId,
      keyPoints: finalKeyPoints,
      simplifiedText,
      mainTopics: this.mergeTopics([
        ...chunkSummaries.map((summary) => summary.mainTopics),
        ...sectionSummaries.map((summary) => summary.mainTopics),
      ]),
      modelUsed: 'hierarchical-extractive-mvp',
      promptTokens: this.countInputTokens(orderedChunks),
      completionTokens: this.countWords(simplifiedText),
    };
  }

  private buildChunkSummary(chunk: SummaryChunk): ChunkSummary {
    const text = this.buildChunkDigest(chunk.content);
    return {
      chunkIndex: chunk.chunkIndex,
      text,
      keyPoints: this.extractKeyPointsFromTexts([text], 2),
      mainTopics: this.extractMainTopics(chunk.content),
      tokenCount: chunk.tokenCount ?? this.countWords(chunk.content),
    };
  }

  private buildSectionSummaries(
    chunkSummaries: ChunkSummary[],
  ): SummarySection[] {
    const sections: SummarySection[] = [];
    const maxSectionChunks = 4;
    const maxSectionTokens = 650;

    let current: ChunkSummary[] = [];
    let currentTokens = 0;

    for (const chunkSummary of chunkSummaries) {
      const nextTokens = currentTokens + chunkSummary.tokenCount;
      const nextChunkCount = current.length + 1;

      if (
        current.length > 0 &&
        (nextChunkCount > maxSectionChunks || nextTokens > maxSectionTokens)
      ) {
        sections.push(this.composeSectionSummary(sections.length, current));
        current = [];
        currentTokens = 0;
      }

      current.push(chunkSummary);
      currentTokens += chunkSummary.tokenCount;
    }

    if (current.length > 0) {
      sections.push(this.composeSectionSummary(sections.length, current));
    }

    return sections;
  }

  private composeSectionSummary(
    sectionIndex: number,
    chunkSummaries: ChunkSummary[],
  ): SummarySection {
    const chunkIndexes = chunkSummaries.map((summary) => summary.chunkIndex);
    const sectionText = this.extractKeyPointsFromTexts(
      chunkSummaries.map((summary) => summary.text),
      3,
    );
    const keyPoints =
      sectionText.length > 0
        ? sectionText
        : chunkSummaries.map((summary) => summary.text);
    const text = this.composeSimplifiedText(keyPoints);

    return {
      sectionIndex,
      chunkIndexes,
      text,
      keyPoints,
      mainTopics: this.mergeTopics(
        chunkSummaries.map((summary) => summary.mainTopics),
      ),
      tokenCount: chunkSummaries.reduce(
        (total, summary) => total + summary.tokenCount,
        0,
      ),
    };
  }

  private buildChunkDigest(content: string) {
    const sentences = this.splitIntoSentences(content);
    if (sentences.length > 0) {
      return sentences.slice(0, 2).join(' ').trim();
    }

    return this.truncateWords(content, 36);
  }

  private extractKeyPointsFromTexts(texts: string[], limit: number) {
    const keyPoints: string[] = [];
    const seen = new Set<string>();

    for (const text of texts) {
      const digest = this.buildChunkDigest(text);
      if (!digest) {
        continue;
      }

      const normalizedDigest = this.normalizeForComparison(digest);
      if (seen.has(normalizedDigest)) {
        continue;
      }

      seen.add(normalizedDigest);
      keyPoints.push(digest);

      if (keyPoints.length >= limit) {
        break;
      }
    }

    return keyPoints;
  }

  private composeSimplifiedText(keyPoints: string[]) {
    return keyPoints
      .map((point) => point.trim())
      .filter(Boolean)
      .map((point) => this.ensureTerminalPunctuation(point))
      .join(' ');
  }

  private extractMainTopics(text: string) {
    const stopWords = new Set([
      'va',
      'la',
      'cua',
      'co',
      'cho',
      'the',
      'and',
      'you',
      'that',
      'this',
      'with',
      'mot',
      'cac',
      'nhung',
      'trong',
      'voi',
      'nay',
      'duoc',
      'de',
      'o',
      'tu',
      'neu',
    ]);

    const frequencies = new Map<string, { word: string; count: number }>();
    const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];

    for (const word of words) {
      const normalized = this.normalizeTopicWord(word);
      if (normalized.length <= 3 || stopWords.has(normalized)) {
        continue;
      }

      const current = frequencies.get(normalized);
      if (current) {
        current.count += 1;
      } else {
        frequencies.set(normalized, {
          word,
          count: 1,
        });
      }
    }

    return [...frequencies.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 5)
      .map((entry) => entry.word);
  }

  private mergeTopics(topicGroups: string[][]) {
    const frequencies = new Map<string, { word: string; count: number }>();

    for (const topicGroup of topicGroups) {
      for (const topic of topicGroup) {
        const normalized = this.normalizeTopicWord(topic);
        if (!normalized) {
          continue;
        }

        const current = frequencies.get(normalized);
        if (current) {
          current.count += 1;
        } else {
          frequencies.set(normalized, {
            word: topic,
            count: 1,
          });
        }
      }
    }

    return [...frequencies.values()]
      .sort((left, right) => right.count - left.count)
      .slice(0, 5)
      .map((entry) => entry.word);
  }

  private countInputTokens(chunks: SummaryChunk[]) {
    return chunks.reduce((total, chunk) => {
      return total + (chunk.tokenCount ?? this.countWords(chunk.content));
    }, 0);
  }

  private splitIntoSentences(text: string) {
    return (
      text
        .match(/[^.!?]+[.!?]?/g)
        ?.map((sentence) => sentence.trim())
        .filter(Boolean) ?? []
    );
  }

  private truncateWords(text: string, maxWords: number) {
    const words = text.split(/\s+/).filter(Boolean);
    return words.slice(0, maxWords).join(' ');
  }

  private ensureTerminalPunctuation(text: string) {
    if (/[.!?]$/.test(text)) {
      return text;
    }

    return `${text}.`;
  }

  private normalizeTopicWord(word: string) {
    return word
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private normalizeForComparison(value: string) {
    return this.normalizeTopicWord(value).replace(/[^\p{L}\p{N}]+/gu, ' ');
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Summary for this video already exists');
      }

      if (error.code === 'P2003') {
        throw new NotFoundException(`Video with id "${id}" not found`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Summary with id "${id}" not found`);
      }
    }

    throw error;
  }

  private countWords(text: string) {
    return text.split(/\s+/).filter(Boolean).length;
  }
}
