import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlashcardSetDto } from './dto/create-flashcard-set.dto';
import { UpdateFlashcardSetDto } from './dto/update-flashcard-set.dto';

@Injectable()
export class FlashcardSetService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createFlashcardSetDto: CreateFlashcardSetDto) {
    try {
      return await this.prisma.flashcardSet.create({
        data: createFlashcardSetDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createFlashcardSetDto.videoId);
    }
  }

  findAll(videoId?: string) {
    return this.prisma.flashcardSet.findMany({
      where: videoId ? { videoId } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const flashcardSet = await this.prisma.flashcardSet.findUnique({
      where: {
        id,
      },
    });

    if (!flashcardSet) {
      throw new NotFoundException(`FlashcardSet with id "${id}" not found`);
    }

    return flashcardSet;
  }

  async update(id: string, updateFlashcardSetDto: UpdateFlashcardSetDto) {
    try {
      return await this.prisma.flashcardSet.update({
        where: {
          id,
        },
        data: updateFlashcardSetDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.flashcardSet.delete({
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
        throw new NotFoundException(`FlashcardSet with id "${id}" not found`);
      }
    }

    throw error;
  }
}
