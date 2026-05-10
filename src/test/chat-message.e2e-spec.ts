import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChatMessageService } from '../chat-messages/chat-message.service';
import {
  cleanupTestData,
  createTestingApp,
  seedChatMessage,
  seedChatSession,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Chat Message API (/chat-messages)', () => {
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

    const mockAsk = jest.spyOn(ChatMessageService.prototype, 'ask');
    mockAsk.mockImplementation(async (dto: any) => {
      const userMsg = await prisma.chatMessage.create({
        data: {
          sessionId: dto.sessionId,
          role: 'user',
          content: dto.content,
        },
      });

      const assistantMsg = await prisma.chatMessage.create({
        data: {
          sessionId: dto.sessionId,
          role: 'assistant',
          content: `Mock answer to: ${dto.content}`,
          promptTokens: 100,
          completionTokens: 50,
          retrievedChunks: [],
        },
      });

      return {
        sessionId: dto.sessionId,
        videoId: null,
        projectId: null,
        question: dto.content,
        answer: `Mock answer to: ${dto.content}`,
        modelUsed: 'mock-model',
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        retrievedChunks: [],
      } as any;
    });
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /chat-messages', () => {
    it('creates a chat message', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);

      const res = await http
        .post('/chat-messages')
        .send({
          sessionId: session.id,
          role: 'user',
          content: 'Hello world',
        })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.role).toBe('user');
      expect(res.body.content).toBe('Hello world');
    });

    it('accepts any role value at runtime (only length checked)', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);

      const res = await http
        .post('/chat-messages')
        .send({
          sessionId: session.id,
          role: 'moderator',
          content: 'Test',
        })
        .expect(201);

      expect(res.body.role).toBe('moderator');
    });

    it('returns 400 for missing required fields', async () => {
      await http.post('/chat-messages').send({}).expect(400);
    });
  });

  describe('POST /chat-messages/ask', () => {
    it('returns an AI answer via RAG', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);
      const session = await seedChatSession(prisma, {
        videoId: video.id,
      });
      testIds.sessionIds.push(session.id);

      const res = await http
        .post('/chat-messages/ask')
        .send({
          sessionId: session.id,
          content: 'What is this video about?',
        })
        .expect(201);

      expect(res.body.question).toBe('What is this video about?');
      expect(res.body.answer).toContain('Mock answer');
      expect(res.body.userMessage).toBeDefined();
      expect(res.body.assistantMessage).toBeDefined();
    });

    it('returns 400 for missing sessionId', async () => {
      await http
        .post('/chat-messages/ask')
        .send({ content: 'Question?' })
        .expect(400);
    });

    it('returns 400 for empty question', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);

      await http
        .post('/chat-messages/ask')
        .send({ sessionId: session.id, content: '' })
        .expect(400);
    });
  });

  describe('GET /chat-messages/memory-embeddings', () => {
    it('lists memory embeddings', async () => {
      const res = await http
        .get('/chat-messages/memory-embeddings')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /chat-messages/memory-embeddings/rebuild', () => {
    it('rebuilds memory embeddings', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);

      const res = await http
        .post('/chat-messages/memory-embeddings/rebuild')
        .send({ sessionId: session.id })
        .expect(201);

      expect(res.body).toBeDefined();
    });
  });

  describe('GET /chat-messages', () => {
    it('lists all messages', async () => {
      const res = await http.get('/chat-messages').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('filters messages by sessionId', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);
      await seedChatMessage(prisma, session.id);

      const res = await http
        .get(`/chat-messages?sessionId=${session.id}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /chat-messages/:id', () => {
    it('returns a message by id', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);
      const message = await seedChatMessage(prisma, session.id);

      const res = await http
        .get(`/chat-messages/${message.id}`)
        .expect(200);

      expect(res.body.id).toBe(message.id);
    });

    it('returns 404 for non-existent message', async () => {
      await http
        .get('/chat-messages/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /chat-messages/:id', () => {
    it('updates a message', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);
      const message = await seedChatMessage(prisma, session.id);

      const res = await http
        .patch(`/chat-messages/${message.id}`)
        .send({ content: 'Updated content' })
        .expect(200);

      expect(res.body.content).toBe('Updated content');
    });
  });

  describe('DELETE /chat-messages/:id', () => {
    it('deletes a message', async () => {
      const session = await seedChatSession(prisma);
      testIds.sessionIds.push(session.id);
      const message = await seedChatMessage(prisma, session.id);

      await http.delete(`/chat-messages/${message.id}`).expect(200);
    });

    it('returns 404 for non-existent message', async () => {
      await http
        .delete('/chat-messages/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
