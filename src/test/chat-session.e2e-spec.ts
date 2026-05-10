import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanupTestData,
  createTestingApp,
  seedChatSession,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Chat Session API (/chat-sessions)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let testIds: { videoIds: string[]; sessionIds: string[] };

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;
    testIds = { videoIds: [], sessionIds: [] };
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /chat-sessions', () => {
    it('creates a video-scoped session', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post('/chat-sessions')
        .send({ videoId: video.id, title: 'Video Chat' })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.title).toBe('Video Chat');
      testIds.sessionIds.push(res.body.id);
    });

  });

  describe('GET /chat-sessions', () => {
    it('lists all sessions', async () => {
      const res = await http.get('/chat-sessions').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters sessions by videoId', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      await seedChatSession(prisma, { videoId: video.id });

      const res = await http
        .get(`/chat-sessions?videoId=${video.id}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /chat-sessions/:id', () => {
    it('returns a session by id', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);

      const res = await http
        .get(`/chat-sessions/${session.id}`)
        .expect(200);

      expect(res.body.id).toBe(session.id);
    });

    it('returns 404 for non-existent session', async () => {
      await http
        .get('/chat-sessions/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /chat-sessions/:id', () => {
    it('updates a session', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);

      const res = await http
        .patch(`/chat-sessions/${session.id}`)
        .send({ title: 'Updated Chat' })
        .expect(200);

      expect(res.body.title).toBe('Updated Chat');
    });
  });

  describe('DELETE /chat-sessions/:id', () => {
    it('deletes a session', async () => {
      const session = await seedChatSession(prisma);

      await http.delete(`/chat-sessions/${session.id}`).expect(200);
    });

    it('returns 404 for non-existent session', async () => {
      await http
        .delete('/chat-sessions/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
