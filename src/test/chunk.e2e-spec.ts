import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkService } from '../chunks/chunk.service';
import {
  cleanupTestData,
  createTestingApp,
  seedChunk,
  seedTranscript,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Chunk API (/chunks)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let testIds: { videoIds: string[]; chunkIds: string[] };
  let mockPreview: jest.SpyInstance;
  let mockFromVideo: jest.SpyInstance;

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;
    testIds = { videoIds: [], chunkIds: [] };

    mockPreview = jest
      .spyOn(ChunkService.prototype, 'previewTranscriptChunks')
      .mockResolvedValue({
        strategy: 'fixed-word-fallback',
        chunks: [
          {
            content: 'Mock chunk 1.',
            chunkIndex: 0,
            tokenCount: 10,
            startChar: 0,
            endChar: 13,
          },
          {
            content: 'Mock chunk 2.',
            chunkIndex: 1,
            tokenCount: 10,
            startChar: 14,
            endChar: 27,
          },
        ],
      } as any);

    mockFromVideo = jest
      .spyOn(ChunkService.prototype, 'previewChunksFromVideo')
      .mockResolvedValue({
        strategy: 'fixed-word-fallback',
        videoId: '',
        transcriptId: '',
        source: 'youtube_caption',
        wordCount: 100,
        chunks: [],
      } as any);
  });

  afterAll(async () => {
    mockPreview.mockRestore();
    mockFromVideo.mockRestore();
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /chunks', () => {
    it('creates a chunk', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const transcript = await seedTranscript(prisma, { videoId: video.id });

      const res = await http
        .post('/chunks')
        .send({
          videoId: video.id,
          transcriptId: transcript.id,
          content: 'This is a test chunk content.',
          chunkIndex: 0,
        })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.content).toBe('This is a test chunk content.');
      testIds.chunkIds.push(res.body.id);
    });

    it('returns 400 for missing required fields', async () => {
      await http.post('/chunks').send({ content: 'no ids' }).expect(400);
    });
  });

  describe('POST /chunks/preview', () => {
    it('returns chunk preview for raw text', async () => {
      const res = await http
        .post('/chunks/preview')
        .send({
          rawText: 'Some test text to preview chunking.',
        })
        .expect(201);

      expect(res.body.strategy).toBeDefined();
      expect(Array.isArray(res.body.chunks)).toBe(true);
    });
  });

  describe('POST /chunks/from-video/:videoId', () => {
    it('returns chunk preview from a video', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      await seedTranscript(prisma, { videoId: video.id });

      const res = await http
        .post(`/chunks/from-video/${video.id}`)
        .expect(201);

      expect(res.body.strategy).toBeDefined();
    });
  });

  describe('GET /chunks', () => {
    it('lists all chunks', async () => {
      const res = await http.get('/chunks').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters chunks by videoId', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const transcript = await seedTranscript(prisma, { videoId: video.id });
      const chunk = await seedChunk(prisma, {
        videoId: video.id,
        transcriptId: transcript.id,
      });
      testIds.chunkIds.push(chunk.id);

      const res = await http
        .get(`/chunks?videoId=${video.id}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /chunks/:id', () => {
    it('returns a chunk by id', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const transcript = await seedTranscript(prisma, { videoId: video.id });
      const chunk = await seedChunk(prisma, {
        videoId: video.id,
        transcriptId: transcript.id,
      });
      testIds.chunkIds.push(chunk.id);

      const res = await http.get(`/chunks/${chunk.id}`).expect(200);
      expect(res.body.id).toBe(chunk.id);
    });

    it('returns 404 for non-existent chunk', async () => {
      await http
        .get('/chunks/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /chunks/:id', () => {
    it('updates a chunk', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const transcript = await seedTranscript(prisma, { videoId: video.id });
      const chunk = await seedChunk(prisma, {
        videoId: video.id,
        transcriptId: transcript.id,
      });
      testIds.chunkIds.push(chunk.id);

      const res = await http
        .patch(`/chunks/${chunk.id}`)
        .send({ content: 'Updated content' })
        .expect(200);

      expect(res.body.content).toBe('Updated content');
    });
  });

  describe('DELETE /chunks/:id', () => {
    it('deletes a chunk', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const transcript = await seedTranscript(prisma, { videoId: video.id });
      const chunk = await seedChunk(prisma, {
        videoId: video.id,
        transcriptId: transcript.id,
      });

      await http.delete(`/chunks/${chunk.id}`).expect(200);
    });

    it('returns 404 for non-existent chunk', async () => {
      await http
        .delete('/chunks/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
