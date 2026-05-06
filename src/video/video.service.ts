import {
  ConflictException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { exec } from 'child_process';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { cleanTranscriptText, parseYoutubeVtt } from './transcript-cleaner';
import { UpdateVideoDto } from './dto/update-video.dto';
import { WhisperService } from '../whisper/whisper.service';

const execAsync = promisify(exec);

@Injectable()
export class VideoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly whisperService: WhisperService,
  ) {}

  async create(createVideoDto: CreateVideoDto) {
    let video:
      | Awaited<ReturnType<PrismaService['video']['create']>>
      | undefined;

    try {
      video = await this.prisma.video.create({
        data: {
          ...createVideoDto,
          status: 'processing',
          errorMessage: null,
        },
      });

      return await this.processVideo(video.id, createVideoDto.youtubeId);
    } catch (error) {
      if (video) {
        await this.prisma.video.update({
          where: {
            id: video.id,
          },
          data: {
            status: 'failed',
            errorMessage:
              error instanceof Error
                ? error.message
                : 'Video processing failed',
          },
        });

        const errorMessage =
          error instanceof Error ? error.message : 'Video processing failed';

        throw new InternalServerErrorException({
          message: `Video was created but processing failed: ${errorMessage}`,
          videoId: video.id,
          status: 'failed',
        });
      }

      this.handlePrismaError(error);
    }
  }

  findAll() {
    return this.prisma.video.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const video = await this.prisma.video.findUnique({
      where: {
        id,
      },
    });

    if (!video) {
      throw new NotFoundException(`Video with id "${id}" not found`);
    }

    return video;
  }

  async update(id: string, updateVideoDto: UpdateVideoDto) {
    try {
      return await this.prisma.video.update({
        where: {
          id,
        },
        data: updateVideoDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.video.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Video youtubeId already exists');
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Video with id "${id}" not found`);
      }
    }

    throw error;
  }

  private async processVideo(videoId: string, youtubeId: string) {
    let rawText: string;
    let source: 'youtube_caption' | 'whisper';

    try {
      rawText = await this.fetchYoutubeTranscript(youtubeId);
      source = 'youtube_caption';
    } catch {
      rawText = await this.whisperService.transcribeFromYoutube(youtubeId);
      source = 'whisper';
    }

    const cleanedText = cleanTranscriptText(rawText);
    const wordCount = this.countWords(cleanedText);

    const transcript = await this.prisma.transcript.create({
      data: {
        videoId,
        rawText: cleanedText,
        source,
        wordCount,
      },
    });

    const chunks = this.buildChunks(cleanedText).map((chunk) => ({
      videoId,
      transcriptId: transcript.id,
      content: chunk.content,
      chunkIndex: chunk.chunkIndex,
      tokenCount: this.countWords(chunk.content),
      startChar: chunk.startChar,
      endChar: chunk.endChar,
    }));

    await this.prisma.chunk.createMany({
      data: chunks,
    });

    const summary = await this.prisma.summary.create({
      data: this.buildSummary(videoId, chunks.map((chunk) => chunk.content)),
    });

    const completedVideo = await this.prisma.video.update({
      where: {
        id: videoId,
      },
      data: {
        status: 'completed',
        errorMessage: null,
      },
    });

    return {
      video: completedVideo,
      transcript,
      chunksCreated: chunks.length,
      summary,
    };
  }

  private async fetchYoutubeTranscript(youtubeId: string) {
    const languages = ['vi', 'en'];

    for (const language of languages) {
      try {
        const outputPath = join(process.cwd(), 'temp_audio');
        const subtitleFile = join(outputPath, `${youtubeId}.${language}.vtt`);

        await execAsync(
          `yt-dlp --write-auto-sub --sub-lang ${language} --skip-download --sub-format vtt -o "${join(outputPath, `${youtubeId}.%(ext)s`)}" "https://www.youtube.com/watch?v=${youtubeId}" --no-playlist`,
          { timeout: 60_000 },
        );

        if (existsSync(subtitleFile)) {
          const vtt = readFileSync(subtitleFile, 'utf-8');
          const transcript = parseYoutubeVtt(vtt);
          unlinkSync(subtitleFile);
          if (transcript) {
            return transcript;
          }
        }
      } catch {
        continue;
      }
    }

    throw new Error('No YouTube captions found for this video');
  }
  private parseTimedText(xml: string) {
    const matches = [...xml.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)];

    const text = matches
      .map((match) => this.decodeHtml(match[1]))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return text.length > 0 ? text : null;
  }

  private decodeHtml(value: string) {
    return value
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (_, code: string) =>
        String.fromCharCode(Number(code)),
      );
  }

  private buildChunks(rawText: string) {
    const maxWords = 180;
    const words = rawText.split(/\s+/).filter(Boolean);
    const chunks: Array<{
      content: string;
      chunkIndex: number;
      startChar: number;
      endChar: number;
    }> = [];
    let cursor = 0;

    for (let index = 0; index < words.length; index += maxWords) {
      const content = words.slice(index, index + maxWords).join(' ');
      const startChar = rawText.indexOf(content.split(' ')[0], cursor);
      const endChar = startChar + content.length;
      cursor = endChar;

      chunks.push({
        content,
        chunkIndex: chunks.length,
        startChar: Math.max(startChar, 0),
        endChar,
      });
    }

    return chunks;
  }

  private buildSummary(videoId: string, chunks: string[]) {
    const keyPoints = chunks.slice(0, 5).map((chunk) => {
      const sentences = chunk.match(/[^.!?。！？]+[.!?。！？]?/g) ?? [chunk];
      return sentences[0].trim();
    });
    const simplifiedText = keyPoints.join(' ');

    return {
      videoId,
      keyPoints,
      simplifiedText,
      mainTopics: this.extractMainTopics(chunks.join(' ')),
      modelUsed: 'extractive-mvp',
      promptTokens: 0,
      completionTokens: this.countWords(simplifiedText),
    };
  }

  private extractMainTopics(text: string) {
    const stopWords = new Set([
      'và',
      'là',
      'của',
      'có',
      'cho',
      'the',
      'and',
      'you',
      'that',
      'this',
      'with',
    ]);

    const counts = text
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => word.length > 3 && !stopWords.has(word))
      .reduce<Record<string, number>>((accumulator, word) => {
        accumulator[word] = (accumulator[word] ?? 0) + 1;
        return accumulator;
      }, {});

    return Object.entries(counts ?? {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  private countWords(text: string) {
    return text.split(/\s+/).filter(Boolean).length;
  }
}
