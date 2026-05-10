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
import { SummaryService } from '../summaries/summary.service';
import { WhisperService } from '../whisper/whisper.service';

const execAsync = promisify(exec);

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly whisperService: WhisperService,
    private readonly summaryService: SummaryService,
  ) {}

  async create(createVideoDto: CreateVideoDto) {
    let video:
      | Awaited<ReturnType<PrismaService['video']['create']>>
      | undefined;

    const youtubeId = createVideoDto.youtubeId!;

    try {
      video = await this.prisma.video.create({
        data: {
          youtubeId,
          url: createVideoDto.url,
          title: createVideoDto.title,
          projectId: createVideoDto.projectId ?? null,
          durationSec: createVideoDto.durationSec,
          language: createVideoDto.language,
          status: 'processing',
          errorMessage: null,
        },
      });

      return await this.processVideo(video.id, youtubeId);
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

      if (error.code === 'P2003') {
        throw new NotFoundException('Related project not found');
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

    let summary:
      | Awaited<ReturnType<SummaryService['createFromVideo']>>
      | null = null;

    try {
      summary = await this.summaryService.createFromVideo(videoId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'summary generation failed';
      this.logger.warn(
        `Summary generation failed for video "${videoId}": ${message}`,
      );
    }

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

  private countWords(text: string) {
    return text.split(/\s+/).filter(Boolean).length;
  }
}
