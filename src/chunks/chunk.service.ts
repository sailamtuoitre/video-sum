import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChunkDto } from './dto/create-chunk.dto';
import { UpdateChunkDto } from './dto/update-chunk.dto';

@Injectable()
export class ChunkService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createChunkDto: CreateChunkDto) {
    try {
      return await this.prisma.chunk.create({
        data: createChunkDto,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAll(videoId?: string, transcriptId?: string) {
    return this.prisma.chunk.findMany({
      where: {
        ...(videoId ? { videoId } : {}),
        ...(transcriptId ? { transcriptId } : {}),
      },
      orderBy: [
        {
          videoId: 'asc',
        },
        {
          chunkIndex: 'asc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const chunk = await this.prisma.chunk.findUnique({
      where: {
        id,
      },
    });

    if (!chunk) {
      throw new NotFoundException(`Chunk with id "${id}" not found`);
    }

    return chunk;
  }

  async update(id: string, updateChunkDto: UpdateChunkDto) {
    try {
      return await this.prisma.chunk.update({
        where: {
          id,
        },
        data: updateChunkDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.chunk.delete({
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
        throw new NotFoundException('Related video or transcript not found');
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Chunk with id "${id}" not found`);
      }
    }

    throw error;
  }
}
