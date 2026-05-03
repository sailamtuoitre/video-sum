import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';

@Injectable()
export class QuizQuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createQuizQuestionDto: CreateQuizQuestionDto) {
    try {
      return await this.prisma.quizQuestion.create({
        data: createQuizQuestionDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createQuizQuestionDto.quizId);
    }
  }

  findAll(quizId?: string) {
    return this.prisma.quizQuestion.findMany({
      where: quizId ? { quizId } : undefined,
      orderBy: [
        {
          quizId: 'asc',
        },
        {
          questionIndex: 'asc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const quizQuestion = await this.prisma.quizQuestion.findUnique({
      where: {
        id,
      },
    });

    if (!quizQuestion) {
      throw new NotFoundException(`QuizQuestion with id "${id}" not found`);
    }

    return quizQuestion;
  }

  async update(id: string, updateQuizQuestionDto: UpdateQuizQuestionDto) {
    try {
      return await this.prisma.quizQuestion.update({
        where: {
          id,
        },
        data: updateQuizQuestionDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.quizQuestion.delete({
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
        throw new NotFoundException('Related quiz or chunk not found');
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`QuizQuestion with id "${id}" not found`);
      }
    }

    throw error;
  }
}
