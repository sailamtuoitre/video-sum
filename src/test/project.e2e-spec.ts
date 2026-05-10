import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanupTestData,
  createTestingApp,
  seedProject,
  seedVideo,
  UUID_REGEX,
} from './setup';
import * as request from 'supertest';

describe('Project API (/projects)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: request.Agent;
  let testIds: { videoIds: string[]; projectIds: string[] };

  beforeAll(async () => {
    const ctx = await createTestingApp();
    app = ctx.app;
    prisma = ctx.prisma;
    http = ctx.http;
    testIds = { videoIds: [], projectIds: [] };
  });

  afterAll(async () => {
    await cleanupTestData(prisma, testIds);
    await app.close();
  });

  describe('POST /projects', () => {
    it('creates a project with name only', async () => {
      const res = await http
        .post('/projects')
        .send({ name: 'My Test Project' })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      expect(res.body.name).toBe('My Test Project');
      testIds.projectIds.push(res.body.id);
    });

    it('creates a project with videoIds', async () => {
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post('/projects')
        .send({
          name: 'Project with videos',
          videoIds: [video.id],
        })
        .expect(201);

      expect(res.body.id).toMatch(UUID_REGEX);
      testIds.projectIds.push(res.body.id);
    });

    it('returns 400 for empty name', async () => {
      await http
        .post('/projects')
        .send({ name: '' })
        .expect(400);
    });

    it('returns 400 for missing name', async () => {
      await http.post('/projects').send({}).expect(400);
    });
  });

  describe('GET /projects', () => {
    it('lists all projects', async () => {
      const res = await http.get('/projects').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /projects/:id', () => {
    it('returns a project by id', async () => {
      const project = await seedProject(prisma);
      testIds.projectIds.push(project.id);

      const res = await http.get(`/projects/${project.id}`).expect(200);
      expect(res.body.id).toBe(project.id);
    });

    it('returns 404 for non-existent project', async () => {
      await http
        .get('/projects/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PATCH /projects/:id', () => {
    it('updates a project', async () => {
      const project = await seedProject(prisma);
      testIds.projectIds.push(project.id);

      const res = await http
        .patch(`/projects/${project.id}`)
        .send({ name: 'Updated Project' })
        .expect(200);

      expect(res.body.name).toBe('Updated Project');
    });
  });

  describe('POST /projects/:id/videos', () => {
    it('adds videos to a project', async () => {
      const project = await seedProject(prisma);
      testIds.projectIds.push(project.id);
      const video = await seedVideo(prisma);
      testIds.videoIds.push(video.id);

      const res = await http
        .post(`/projects/${project.id}/videos`)
        .send({ videoIds: [video.id] })
        .expect(201);

      expect(Array.isArray(res.body.videos)).toBe(true);
    });
  });

  describe('GET /projects/:id/videos', () => {
    it('lists videos in a project', async () => {
      const project = await seedProject(prisma);
      testIds.projectIds.push(project.id);

      const res = await http
        .get(`/projects/${project.id}/videos`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('DELETE /projects/:id', () => {
    it('deletes a project', async () => {
      const project = await seedProject(prisma);
      await http.delete(`/projects/${project.id}`).expect(200);
    });

    it('returns 404 for non-existent project', async () => {
      await http
        .delete('/projects/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });
});
