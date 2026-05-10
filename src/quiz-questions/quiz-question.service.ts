import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CheckQuizQuestionAnswerDto } from './dto/check-quiz-question-answer.dto';

type QuizOption = 'A' | 'B' | 'C' | 'D';

type QuizQuestionAnswerResult = {
  questionId: string;
  questionText: string;
  selectedOption: QuizOption;
  selectedAnswerText: string | null;
  correctOption: QuizOption;
  correctAnswerText: string | null;
  isCorrect: boolean;
  result: 'correct' | 'incorrect';
  feedback: string;
  explanation: string | null;
};

@Injectable()
export class QuizQuestionService {
  constructor(private readonly prisma: PrismaService) {}

  async checkAnswer(
    id: string,
    answerDto: CheckQuizQuestionAnswerDto,
  ): Promise<QuizQuestionAnswerResult> {
    const question = await this.prisma.quizQuestion.findUnique({
      where: {
        id,
      },
    });

    if (!question) {
      throw new NotFoundException(`QuizQuestion with id "${id}" not found`);
    }

    const options = this.normalizeOptions(question.options);
    const selectedOption = answerDto.selectedOption;
    const correctOption = this.normalizeCorrectOption(question.correctOption);
    const selectedAnswerText = options[selectedOption];
    const correctAnswerText = options[correctOption];
    const isCorrect = selectedOption === correctOption;

    return {
      questionId: question.id,
      questionText: question.questionText,
      selectedOption,
      selectedAnswerText,
      correctOption,
      correctAnswerText,
      isCorrect,
      result: isCorrect ? 'correct' : 'incorrect',
      feedback: isCorrect
        ? 'Đúng rồi.'
        : `Sai rồi. Đáp án đúng là ${correctOption}${correctAnswerText ? `: ${correctAnswerText}` : ''}.`,
      explanation: question.explanation ?? null,
    };
  }

  private normalizeCorrectOption(value: string): QuizOption {
    if (value === 'A' || value === 'B' || value === 'C' || value === 'D') {
      return value;
    }

    return 'A';
  }

  private normalizeOptions(
    options: Prisma.JsonValue,
  ): Record<QuizOption, string | null> {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      return {
        A: null,
        B: null,
        C: null,
        D: null,
      };
    }

    const record = options as Record<string, unknown>;

    return {
      A: typeof record.A === 'string' ? record.A : null,
      B: typeof record.B === 'string' ? record.B : null,
      C: typeof record.C === 'string' ? record.C : null,
      D: typeof record.D === 'string' ? record.D : null,
    };
  }
}
