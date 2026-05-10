import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SummaryService } from '../summaries/summary.service';
import {
  cleanupTestData,
  createTestingApp,
  seedSummary,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Summary API (/summaries)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let testIds: { videoIds: string[] };

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;
    testIds = { videoIds: [] };

    const mockCreateFromVideo = jest.spyOn(
      SummaryService.prototype,
      'createFromVideo',
    );
    mockCreateFromVideo.mockImplementation(async (videoId: string) => {
      return prisma.summary.upsert({
        where: { videoId },
        create: {
          videoId,
          keyPoints: ['Mock generated key point'],
          simplifiedText: 'Mock generated summary.',
        },
        update: {},
      });
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /summaries', () => {
    it('creates a summary manually', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post('/summaries')
        .send({
          videoId: video.id,
          keyPoints: ['Point 1', 'Point 2'],
          simplifiedText: 'Manual summary text.',
        })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.simplifiedText).toBe('Manual summary text.');
    });

    it('returns 400 for missing keyPoints', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      await http
        .post('/summaries')
        .send({
          videoId: video.id,
          simplifiedText: 'Missing key points.',
        })
        .expect(400);
    });
  });

  describe('POST /summaries/from-video/:videoId', () => {
    it('generates a summary from video', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post(`/summaries/from-video/${video.id}`)
        .expect(201);

      expect(res.body.videoId).toBe(video.id);
    });
  });

  describe('GET /summaries', () => {
    it('lists all summaries', async () => {
      const res = await http.get('/summaries').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters summaries by videoId', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      await seedSummary(prisma, video.id);

      const res = await http
        .get(`/summaries?videoId=${video.id}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /summaries/:id', () => {
    it('returns a summary by id', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const summary = await seedSummary(prisma, video.id);

      const res = await http.get(`/summaries/${summary.id}`).expect(200);
      expect(res.body.id).toBe(summary.id);
    });

    it('returns 404 for non-existent summary', async () => {
      await http
        .get('/summaries/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /summaries/:id', () => {
    it('updates a summary', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const summary = await seedSummary(prisma, video.id);

      const res = await http
        .patch(`/summaries/${summary.id}`)
        .send({ simplifiedText: 'Updated summary text.' })
        .expect(200);

      expect(res.body.simplifiedText).toBe('Updated summary text.');
    });
  });

  describe('DELETE /summaries/:id', () => {
    it('deletes a summary', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const summary = await seedSummary(prisma, video.id);

      await http.delete(`/summaries/${summary.id}`).expect(200);
    });

    it('returns 404 for non-existent summary', async () => {
      await http
        .delete('/summaries/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
