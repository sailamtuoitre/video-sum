import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckQuizQuestionAnswerDto } from './dto/check-quiz-question-answer.dto';
import { CreateQuizQuestionDto } from './dto/create-quiz-question.dto';
import { UpdateQuizQuestionDto } from './dto/update-quiz-question.dto';

type QuizQuestionAnswerResult = {
  questionId: string;
  questionText: string;
  selectedOption: 'A' | 'B' | 'C' | 'D';
  selectedAnswerText: string | null;
  correctOption: 'A' | 'B' | 'C' | 'D';
  correctAnswerText: string | null;
  isCorrect: boolean;
  result: 'correct' | 'incorrect';
  feedback: string;
  explanation: string | null;
};

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

  async checkAnswer(
    id: string,
    answerDto: CheckQuizQuestionAnswerDto,
  ): Promise<QuizQuestionAnswerResult> {
    const quizQuestion = await this.prisma.quizQuestion.findUnique({
      where: {
        id,
      },
    });

    if (!quizQuestion) {
      throw new NotFoundException(`QuizQuestion with id "${id}" not found`);
    }

    const options = this.normalizeOptions(quizQuestion.options);
    const selectedOption = answerDto.selectedOption;
    const correctOption = quizQuestion.correctOption as 'A' | 'B' | 'C' | 'D';
    const selectedAnswerText = options[selectedOption];
    const correctAnswerText = options[correctOption];
    const isCorrect = selectedOption === correctOption;

    return {
      questionId: quizQuestion.id,
      questionText: quizQuestion.questionText,
      selectedOption,
      selectedAnswerText,
      correctOption,
      correctAnswerText,
      isCorrect,
      result: isCorrect ? 'correct' : 'incorrect',
      feedback: isCorrect
        ? 'Đúng rồi.'
        : `Sai rồi. Đáp án đúng là ${correctOption}${correctAnswerText ? `: ${correctAnswerText}` : ''}.`,
      explanation: quizQuestion.explanation ?? null,
    };
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

  private normalizeOptions(options: Prisma.JsonValue) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return { A: null, B: null, C: null, D: null } as const;
    }

    const record = options as Record<string, unknown>;
    return {
      A: typeof record.A === 'string' ? record.A : null,
      B: typeof record.B === 'string' ? record.B : null,
      C: typeof record.C === 'string' ? record.C : null,
      D: typeof record.D === 'string' ? record.D : null,
    } as const;
  }
}
