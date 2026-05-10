import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuizService } from '../quizzes/quiz.service';
import {
  cleanupTestData,
  createTestingApp,
  seedQuiz,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Quiz API (/quizzes)', () => {
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

    const mockCreateFromVideo = jest.spyOn(
      QuizService.prototype,
      'createFromVideo',
    );
    mockCreateFromVideo.mockImplementation(async (videoId: string) => {
      const quiz = await prisma.quiz.create({
        data: {
          videoId,
          title: 'Mock Generated Quiz',
          totalQuestions: 2,
          modelUsed: 'mock-model',
        },
      });

      await prisma.quizQuestion.createMany({
        data: [
          {
            quizId: quiz.id,
            questionText: 'Mock question 1?',
            options: { A: 'A1', B: 'B1', C: 'C1', D: 'D1' },
            correctOption: 'A',
            questionIndex: 0,
          },
          {
            quizId: quiz.id,
            questionText: 'Mock question 2?',
            options: { A: 'A2', B: 'B2', C: 'C2', D: 'D2' },
            correctOption: 'B',
            questionIndex: 1,
          },
        ],
      });

      return prisma.quiz.findUnique({
        where: { id: quiz.id },
        include: { questions: { orderBy: { questionIndex: 'asc' } } },
      }) as any;
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /quizzes', () => {
    it('creates a quiz', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post('/quizzes')
        .send({ videoId: video.id, title: 'My Quiz' })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.title).toBe('My Quiz');
      testIds.quizIds.push(res.body.id);
    });

    it('returns 400 for missing videoId', async () => {
      await http.post('/quizzes').send({}).expect(400);
    });
  });

  describe('POST /quizzes/from-video/:videoId', () => {
    it('generates a quiz from video', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post(`/quizzes/from-video/${video.id}`)
        .expect(201);

      expect(res.body.title).toBe('Mock Generated Quiz');
      expect(res.body.questions).toHaveLength(2);
      testIds.quizIds.push(res.body.id);
    });
  });

  describe('GET /quizzes', () => {
    it('lists all quizzes', async () => {
      const res = await http.get('/quizzes').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters quizzes by videoId', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);

      const res = await http
        .get(`/quizzes?videoId=${video.id}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /quizzes/:id', () => {
    it('returns a quiz by id', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);

      const res = await http.get(`/quizzes/${quiz.id}`).expect(200);
      expect(res.body.id).toBe(quiz.id);
    });

    it('returns 404 for non-existent quiz', async () => {
      await http
        .get('/quizzes/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /quizzes/:id', () => {
    it('updates a quiz', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });
      testIds.quizIds.push(quiz.id);

      const res = await http
        .patch(`/quizzes/${quiz.id}`)
        .send({ title: 'Updated Quiz' })
        .expect(200);

      expect(res.body.title).toBe('Updated Quiz');
    });
  });

  describe('DELETE /quizzes/:id', () => {
    it('deletes a quiz', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const quiz = await seedQuiz(prisma, { videoId: video.id });

      await http.delete(`/quizzes/${quiz.id}`).expect(200);
    });

    it('returns 404 for non-existent quiz', async () => {
      await http
        .delete('/quizzes/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
