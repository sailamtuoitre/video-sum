import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import * as request from 'supertest';

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SeedVideoOpts = {
  youtubeId?: string;
  url?: string;
  title?: string;
  status?: 'pending' | 'processing' | 'completed' | 'failed';
};

type SeedProjectOpts = {
  name?: string;
  description?: string;
  videoIds?: string[];
};

type SeedTranscriptOpts = {
  videoId: string;
  rawText?: string;
  source?: string;
};

type SeedChunkOpts = {
  videoId: string;
  transcriptId: string;
  content?: string;
  chunkIndex?: number;
};

type SeedSessionOpts = {
  videoId?: string;
  projectId?: string;
  title?: string;
};

type SeedQuizOpts = {
  videoId: string;
  title?: string;
};

type SeedQuizQuestionOpts = {
  quizId: string;
  questionText?: string;
  options?: Record<string, string>;
  correctOption?: 'A' | 'B' | 'C' | 'D';
  questionIndex?: number;
};

import { randomBytes } from 'crypto';

function shortId() {
  return randomBytes(4).toString('hex');
}

export function nextSuffix() {
  return shortId();
}

export async function createTestingApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
  http: request.Agent;
}> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const http = request.agent(app.getHttpServer());

  return { app, prisma, http };
}

export async function seedVideo(
  prisma: PrismaService,
  opts: SeedVideoOpts = {},
) {
  const suffix = nextSuffix();
  const ytId = opts.youtubeId ?? `test${suffix}`.slice(0, 20);
  return prisma.video.create({
    data: {
      youtubeId: ytId,
      url: opts.url ?? `https://www.youtube.com/watch?v=${ytId}`,
      title: opts.title ?? `Test Video ${suffix}`,
      status: opts.status ?? 'completed',
    },
  });
}

export async function seedProject(
  prisma: PrismaService,
  opts: SeedProjectOpts = {},
) {
  const suffix = nextSuffix();
  return prisma.project.create({
    data: {
      name: opts.name ?? `Test Project ${suffix}`,
      description: opts.description ?? null,
    },
  });
}

export async function seedTranscript(
  prisma: PrismaService,
  opts: SeedTranscriptOpts,
) {
  return prisma.transcript.create({
    data: {
      videoId: opts.videoId,
      rawText:
        opts.rawText ?? `This is test transcript content for seeding.`,
      source: opts.source ?? 'youtube_caption',
    },
  });
}

export async function seedChunk(
  prisma: PrismaService,
  opts: SeedChunkOpts,
) {
  return prisma.chunk.create({
    data: {
      videoId: opts.videoId,
      transcriptId: opts.transcriptId,
      content: opts.content ?? 'This is a test chunk.',
      chunkIndex: opts.chunkIndex ?? 0,
    },
  });
}

export async function seedSummary(
  prisma: PrismaService,
  videoId: string,
) {
  return prisma.summary.upsert({
    where: { videoId },
    create: {
      videoId,
      keyPoints: ['Key point 1', 'Key point 2'],
      simplifiedText: 'Simplified summary text.',
      mainTopics: ['Topic A', 'Topic B'],
    },
    update: {},
  });
}

export async function seedChatSession(
  prisma: PrismaService,
  opts: SeedSessionOpts = {},
) {
  return prisma.chatSession.create({
    data: {
      videoId: opts.videoId ?? null,
      projectId: opts.projectId ?? null,
      title: opts.title ?? 'Test Chat Session',
    },
  });
}

export async function seedChatMessage(
  prisma: PrismaService,
  sessionId: string,
  opts: { role?: 'user' | 'assistant'; content?: string } = {},
) {
  return prisma.chatMessage.create({
    data: {
      sessionId,
      role: opts.role ?? 'user',
      content: opts.content ?? 'Hello, this is a test message.',
    },
  });
}

export async function seedQuiz(
  prisma: PrismaService,
  opts: SeedQuizOpts,
) {
  return prisma.quiz.create({
    data: {
      videoId: opts.videoId,
      title: opts.title ?? 'Test Quiz',
      totalQuestions: 0,
    },
  });
}

export async function seedQuizQuestion(
  prisma: PrismaService,
  opts: SeedQuizQuestionOpts,
) {
  return prisma.quizQuestion.create({
    data: {
      quizId: opts.quizId,
      questionText: opts.questionText ?? 'What is the answer?',
      options: opts.options ?? { A: 'Option A', B: 'Option B', C: 'Option C', D: 'Option D' },
      correctOption: opts.correctOption ?? 'A',
      questionIndex: opts.questionIndex ?? 0,
    },
  });
}

export async function cleanupTestData(
  prisma: PrismaService,
  ids: {
    videoIds?: string[];
    projectIds?: string[];
    sessionIds?: string[];
    quizIds?: string[];
    flashcardSetIds?: string[];
    chunkIds?: string[];
  },
) {
  if (ids.sessionIds?.length) {
    await prisma.chatMessage.deleteMany({
      where: { sessionId: { in: ids.sessionIds } },
    });
    await prisma.chatSession.deleteMany({
      where: { id: { in: ids.sessionIds } },
    });
  }

  if (ids.flashcardSetIds?.length) {
    await prisma.flashcardStudyProgress.deleteMany({
      where: { setId: { in: ids.flashcardSetIds } },
    });
    await prisma.flashcard.deleteMany({
      where: { setId: { in: ids.flashcardSetIds } },
    });
    await prisma.flashcardSet.deleteMany({
      where: { id: { in: ids.flashcardSetIds } },
    });
  }

  if (ids.quizIds?.length) {
    await prisma.quizQuestion.deleteMany({
      where: { quizId: { in: ids.quizIds } },
    });
    await prisma.quiz.deleteMany({
      where: { id: { in: ids.quizIds } },
    });
  }

  if (ids.chunkIds?.length) {
    await prisma.chunk.deleteMany({
      where: { id: { in: ids.chunkIds } },
    });
  }

  if (ids.videoIds?.length) {
    await prisma.summary.deleteMany({
      where: { videoId: { in: ids.videoIds } },
    });
    await prisma.chunk.deleteMany({
      where: { videoId: { in: ids.videoIds } },
    });
    await prisma.transcript.deleteMany({
      where: { videoId: { in: ids.videoIds } },
    });
    await prisma.video.deleteMany({
      where: { id: { in: ids.videoIds } },
    });
  }

  if (ids.projectIds?.length) {
    await prisma.project.deleteMany({
      where: { id: { in: ids.projectIds } },
    });
  }
}
