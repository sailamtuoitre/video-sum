import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlashcardDto } from './dto/create-flashcard.dto';
import { UpdateFlashcardDto } from './dto/update-flashcard.dto';

@Injectable()
export class FlashcardService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createFlashcardDto: CreateFlashcardDto) {
    try {
      return await this.prisma.flashcard.create({
        data: createFlashcardDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createFlashcardDto.setId);
    }
  }

  findAll(setId?: string) {
    return this.prisma.flashcard.findMany({
      where: setId ? { setId } : undefined,
      orderBy: [
        {
          setId: 'asc',
        },
        {
          cardIndex: 'asc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const flashcard = await this.prisma.flashcard.findUnique({
      where: {
        id,
      },
    });

    if (!flashcard) {
      throw new NotFoundException(`Flashcard with id "${id}" not found`);
    }

    return flashcard;
  }

  async update(id: string, updateFlashcardDto: UpdateFlashcardDto) {
    try {
      return await this.prisma.flashcard.update({
        where: {
          id,
        },
        data: updateFlashcardDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.flashcard.delete({
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
        throw new NotFoundException('Related flashcard set or chunk not found');
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Flashcard with id "${id}" not found`);
      }
    }

    throw error;
  }
}
