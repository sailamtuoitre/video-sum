import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTranscriptDto } from './dto/create-transcript.dto';
import { UpdateTranscriptDto } from './dto/update-transcript.dto';

@Injectable()
export class TranscriptService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createTranscriptDto: CreateTranscriptDto) {
    try {
      return await this.prisma.transcript.create({
        data: createTranscriptDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createTranscriptDto.videoId);
    }
  }

  findAll(videoId?: string) {
    return this.prisma.transcript.findMany({
      where: videoId ? { videoId } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const transcript = await this.prisma.transcript.findUnique({
      where: {
        id,
      },
    });

    if (!transcript) {
      throw new NotFoundException(`Transcript with id "${id}" not found`);
    }

    return transcript;
  }

  async update(id: string, updateTranscriptDto: UpdateTranscriptDto) {
    try {
      return await this.prisma.transcript.update({
        where: {
          id,
        },
        data: updateTranscriptDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.transcript.delete({
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
      if (error.code === 'P2003') {
        throw new NotFoundException(`Video with id "${id}" not found`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Transcript with id "${id}" not found`);
      }
    }

    throw error;
  }
}
