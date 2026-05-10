import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { YoutubeTranscript } from 'youtube-transcript';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import { cleanTranscriptText } from './transcript-cleaner';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
  ) {}

  async create(createVideoDto: CreateVideoDto) {
    let video:
      | Awaited<ReturnType<PrismaService['video']['create']>>
      | undefined;

    if (!createVideoDto.youtubeId) {
      throw new BadRequestException('youtubeId is required');
    }

    try {
      const title =
        createVideoDto.title ??
        (await this.fetchYoutubeTitle(createVideoDto.url)) ??
        null;

      video = await this.prisma.video.create({
        data: {
          youtubeId: createVideoDto.youtubeId,
          url: createVideoDto.url,
          title,
          projectId: createVideoDto.projectId ?? null,
          durationSec: createVideoDto.durationSec,
          language: createVideoDto.language,
          status: 'completed',
          errorMessage: null,
        },
      });

      const transcriptSegments = await YoutubeTranscript.fetchTranscript(
        createVideoDto.youtubeId,
        {
          lang: createVideoDto.language ?? 'vi',
        },
      );
      const transcriptText = cleanTranscriptText(transcriptSegments);

      if (!transcriptText) {
        throw new Error('Transcript text is empty');
      }

      const transcript = await this.prisma.transcript.create({
        data: {
          videoId: video.id,
          rawText: transcriptText,
          source: 'youtube',
          wordCount: transcriptText.split(/\s+/).filter(Boolean).length,
        },
      });
      const rag = await this.ragService.ingestTranscriptText(transcriptText, {
        source: 'youtube_transcript',
        videoId: video.id,
        transcriptId: transcript.id,
        youtubeId: video.youtubeId,
        url: video.url,
      });

      return {
        video,
        transcript,
        rag,
        summary: null,
      };
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

  private async fetchYoutubeTitle(url: string): Promise<string | undefined> {
    try {
      const response = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      );

      if (!response.ok) {
        this.logger.warn(
          `Could not fetch YouTube title: ${response.status} ${response.statusText}`,
        );
        return undefined;
      }

      const data: unknown = await response.json();

      if (!this.isYoutubeOembedResponse(data)) {
        return undefined;
      }

      const title = data.title.trim();
      return title.length > 0 ? title.slice(0, 500) : undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Could not fetch YouTube title: ${message}`);
      return undefined;
    }
  }

  private isYoutubeOembedResponse(value: unknown): value is { title: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'title' in value &&
      typeof value.title === 'string'
    );
  }
}
