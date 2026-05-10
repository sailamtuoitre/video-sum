import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanupTestData,
  createTestingApp,
  seedQuiz,
  seedQuizQuestion,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Quiz Question API (/quiz-questions)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let testIds: { videoIds: string[]; quizIds: string[] };

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;
    testIds = { videoIds: [], quizIds: [] };
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /quiz-questions', () => {
    it('creates a quiz question', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);

      const res = await http
        .post('/quiz-questions')
        .send({
          quizId: quiz.id,
          questionText: 'What is 2+2?',
          options: JSON.stringify({ A: '3', B: '4', C: '5', D: '6' }),
          correctOption: 'B',
          questionIndex: 0,
        })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.questionText).toBe('What is 2+2?');
    });

    it('returns 400 for missing required fields', async () => {
      await http
        .post('/quiz-questions')
        .send({ questionText: 'No quiz id' })
        .expect(400);
    });
  });

  describe('POST /quiz-questions/:id/check-answer', () => {
    it('returns correct=true for right answer', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      const question = await seedQuizQuestion(prisma, {
        quizId: quiz.id,
        correctOption: 'B',
        options: { A: 'A1', B: 'B1', C: 'C1', D: 'D1' },
      });

      const res = await http
        .post(`/quiz-questions/${question.id}/check-answer`)
        .send({ selectedOption: 'B' })
        .expect(201);

      expect(res.body.isCorrect).toBe(true);
      expect(res.body.result).toBe('correct');
    });

    it('returns correct=false for wrong answer', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      const question = await seedQuizQuestion(prisma, {
        quizId: quiz.id,
        correctOption: 'B',
        options: { A: 'A1', B: 'B1', C: 'C1', D: 'D1' },
      });

      const res = await http
        .post(`/quiz-questions/${question.id}/check-answer`)
        .send({ selectedOption: 'A' })
        .expect(201);

      expect(res.body.isCorrect).toBe(false);
      expect(res.body.result).toBe('incorrect');
    });

    it('returns 400 for missing selectedOption', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      const question = await seedQuizQuestion(prisma, {
        quizId: quiz.id,
      });

      await http
        .post(`/quiz-questions/${question.id}/check-answer`)
        .send({})
        .expect(400);
    });

    it('returns 404 for non-existent question', async () => {
      await http
        .post(
          '/quiz-questions/00000000-0000-0000-0000-000000000000/check-answer',
        )
        .send({ selectedOption: 'A' })
        .expect(404);
    });
  });

  describe('GET /quiz-questions', () => {
    it('lists all questions', async () => {
      const res = await http.get('/quiz-questions').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters questions by quizId', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      await seedQuizQuestion(prisma, { quizId: quiz.id });

      const res = await http
        .get(`/quiz-questions?quizId=${quiz.id}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /quiz-questions/:id', () => {
    it('returns a question by id', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      const question = await seedQuizQuestion(prisma, { quizId: quiz.id });

      const res = await http
        .get(`/quiz-questions/${question.id}`)
        .expect(200);

      expect(res.body.id).toBe(question.id);
    });

    it('returns 404 for non-existent question', async () => {
      await http
        .get('/quiz-questions/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /quiz-questions/:id', () => {
    it('updates a question', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      const question = await seedQuizQuestion(prisma, { quizId: quiz.id });

      const res = await http
        .patch(`/quiz-questions/${question.id}`)
        .send({ questionText: 'Updated question?' })
        .expect(200);

      expect(res.body.questionText).toBe('Updated question?');
    });
  });

  describe('DELETE /quiz-questions/:id', () => {
    it('deletes a question', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);
      const question = await seedQuizQuestion(prisma, { quizId: quiz.id });

      await http.delete(`/quiz-questions/${question.id}`).expect(200);
    });

    it('returns 404 for non-existent question', async () => {
      await http
        .delete('/quiz-questions/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
