import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FlashcardSetService } from '../flashcard-sets/flashcard-set.service';
import {
  cleanupTestData,
  createTestingApp,
  seedVideo,
  seedProject,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Flashcard Set API (/flashcard-sets)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let testIds: {
    videoIds: string[];
    projectIds: string[];
    flashcardSetIds: string[];
  };

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;
    testIds = { videoIds: [], projectIds: [], flashcardSetIds: [] };

    jest
      .spyOn(FlashcardSetService.prototype, 'createFromVideo')
      .mockImplementation(async (videoId: string) => {
        const set = await prisma.flashcardSet.create({
          data: {
            videoId,
            title: 'Mock Flashcard Set',
            totalCards: 2,
            modelUsed: 'mock-model',
          },
        });

        await prisma.flashcard.createMany({
          data: [
            { setId: set.id, front: 'Q1', back: 'A1', cardIndex: 0 },
            { setId: set.id, front: 'Q2', back: 'A2', cardIndex: 1 },
          ],
        });

        return prisma.flashcardSet.findUnique({
          where: { id: set.id },
          include: { flashcards: { orderBy: { cardIndex: 'asc' } } },
        }) as any;
      });

    jest
      .spyOn(FlashcardSetService.prototype, 'createFromProject')
      .mockImplementation(async (projectId: string) => {
        const set = await prisma.flashcardSet.create({
          data: {
            projectId,
            title: 'Mock Project Flashcard Set',
            totalCards: 2,
            modelUsed: 'mock-model',
          },
        });

        await prisma.flashcard.createMany({
          data: [
            { setId: set.id, front: 'PQ1', back: 'PA1', cardIndex: 0 },
            { setId: set.id, front: 'PQ2', back: 'PA2', cardIndex: 1 },
          ],
        });

        return prisma.flashcardSet.findUnique({
          where: { id: set.id },
          include: { flashcards: { orderBy: { cardIndex: 'asc' } } },
        }) as any;
      });
  });

  afterAll(async () => {
    await cleanupTestData(prisma, {
      flashcardSetIds: testIds.flashcardSetIds.filter(Boolean),
      videoIds: testIds.videoIds,
      projectIds: testIds.projectIds,
    });
    await app.close();
  });

  it('POST /flashcard-sets/from-video/:videoId generates from video', async () => {
    const video = await seedVideo(prisma);
    testIds.videoIds.push(video.id);

    const res = await http
      .post(`/flashcard-sets/from-video/${video.id}`)
      .expect(201);

    expect(res.body.title).toBe('Mock Flashcard Set');
    expect(res.body.flashcards).toHaveLength(2);
    testIds.flashcardSetIds.push(res.body.id);
  });

  it('POST /flashcard-sets/from-project/:projectId generates from project', async () => {
    const project = await seedProject(prisma);
    testIds.projectIds.push(project.id);

    const res = await http
      .post(`/flashcard-sets/from-project/${project.id}`)
      .expect(201);

    expect(res.body.title).toBe('Mock Project Flashcard Set');
    expect(res.body.flashcards).toHaveLength(2);
    testIds.flashcardSetIds.push(res.body.id);
  });

  it('GET /flashcard-sets lists sets', async () => {
    const res = await http.get('/flashcard-sets').expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /flashcard-sets?videoId filters by videoId', async () => {
    const video = await seedVideo(prisma);
    testIds.videoIds.push(video.id);

    const res = await http
      .get(`/flashcard-sets?videoId=${video.id}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /flashcard-sets/:id returns a set', async () => {
    const video = await seedVideo(prisma);
    testIds.videoIds.push(video.id);

    const createRes = await http
      .post(`/flashcard-sets/from-video/${video.id}`)
      .expect(201);

    testIds.flashcardSetIds.push(createRes.body.id);

    const getRes = await http
      .get(`/flashcard-sets/${createRes.body.id}`)
      .expect(200);

    expect(getRes.body.id).toBe(createRes.body.id);
  });

  it('GET /flashcard-sets/:id/study returns study state', async () => {
    const video = await seedVideo(prisma);
    testIds.videoIds.push(video.id);

    const createRes = await http
      .post(`/flashcard-sets/from-video/${video.id}`)
      .expect(201);

    testIds.flashcardSetIds.push(createRes.body.id);

    const res = await http
      .get(`/flashcard-sets/${createRes.body.id}/study`)
      .expect(200);

    expect(res.body.totalCards).toBeDefined();
  });

  it('POST /flashcard-sets/:id/study/review reviews a card', async () => {
    const video = await seedVideo(prisma);
    testIds.videoIds.push(video.id);

    const createRes = await http
      .post(`/flashcard-sets/from-video/${video.id}`)
      .expect(201);

    testIds.flashcardSetIds.push(createRes.body.id);

    const setRes = await http
      .get(`/flashcard-sets/${createRes.body.id}`)
      .expect(200);

    const flashcardId = setRes.body.flashcards[0]?.id;
    if (flashcardId) {
      const res = await http
        .post(`/flashcard-sets/${createRes.body.id}/study/review`)
        .send({ flashcardId, status: 'known' })
        .expect(201);

      expect(res.body.totalCards).toBeDefined();
    }
  });

  it('POST /flashcard-sets/:id/study/reset resets progress', async () => {
    const video = await seedVideo(prisma);
    testIds.videoIds.push(video.id);

    const createRes = await http
      .post(`/flashcard-sets/from-video/${video.id}`)
      .expect(201);

    testIds.flashcardSetIds.push(createRes.body.id);

    const res = await http
      .post(`/flashcard-sets/${createRes.body.id}/study/reset`)
      .expect(201);

    expect(res.body.totalCards).toBeDefined();
  });
});
