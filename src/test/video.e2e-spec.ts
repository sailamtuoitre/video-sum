import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { VideoService } from '../video/video.service';
import {
  cleanupTestData,
  createTestingApp,
  nextSuffix,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Video API (/videos)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let videoIds: string[] = [];

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;

    const mockCreate = jest.spyOn(VideoService.prototype, 'create');
    mockCreate.mockImplementation(async (dto: any) => {
      const video = await prisma.video.create({
        data: {
          youtubeId: dto.youtubeId,
          url: dto.url,
          title: dto.title ?? null,
          status: 'completed',
        },
      });

      const transcript = await prisma.transcript.create({
        data: {
          videoId: video.id,
          rawText: 'Mock transcript for testing.',
          source: 'youtube_caption',
        },
      });

      const summary = await prisma.summary.upsert({
        where: { videoId: video.id },
        create: {
          videoId: video.id,
          keyPoints: ['Mock key point'],
          simplifiedText: 'Mock summary.',
        },
        update: {},
      });

      return { video, transcript, summary };
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma, { videoIds });
    await app.close();
  });

  describe('POST /videos', () => {
    it('creates a video and returns 201', async () => {
      const ytId = `test-create-${nextSuffix()}`;
      const res = await http
        .post('/videos')
        .send({
          youtubeId: ytId,
          url: `https://www.youtube.com/watch?v=${ytId}`,
          title: 'Test Video',
        })
        .expect(201);

      expect(res.body.video).toBeDefined();
      expect(res.body.video.id).toMatch(UUID_REGEX);
      expect(res.body.video.youtubeId).toBe(ytId);
      expect(res.body.video.status).toBe('completed');
      expect(res.body.transcript).toBeDefined();
      expect(res.body.summary).toBeDefined();
      videoIds.push(res.body.video.id);
    });

    it('returns 400 for invalid youtubeId', async () => {
      await http
        .post('/videos')
        .send({
          youtubeId: '',
          url: 'not-a-url',
        })
        .expect(400);
    });

    it('returns 400 for missing required fields', async () => {
      await http.post('/videos').send({}).expect(400);
    });
  });

  describe('GET /videos', () => {
    it('lists all videos', async () => {
      const res = await http.get('/videos').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /videos/:id', () => {
    it('returns a video by id', async () => {
      const video = await seedVideo(prisma);
      videoIds.push(video.id);

      const res = await http.get(`/videos/${video.id}`).expect(200);
      expect(res.body.id).toBe(video.id);
    });

    it('returns 404 for non-existent video', async () => {
      await http
        .get('/videos/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /videos/:id', () => {
    it('updates a video', async () => {
      const video = await seedVideo(prisma);
      videoIds.push(video.id);

      const res = await http
        .patch(`/videos/${video.id}`)
        .send({ title: 'Updated Title' })
        .expect(200);

      expect(res.body.title).toBe('Updated Title');
    });
  });

  describe('DELETE /videos/:id', () => {
    it('deletes a video', async () => {
      const video = await seedVideo(prisma);
      // Don't push to videoIds since we delete it manually
      await http.delete(`/videos/${video.id}`).expect(200);
    });

    it('returns 404 when deleting non-existent video', async () => {
      await http
        .delete('/videos/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
