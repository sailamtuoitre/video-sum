import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChunkService } from '../chunks/chunk.service';
import { PrismaService } from '../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { UpdateChatSessionDto } from './dto/update-chat-session.dto';

@Injectable()
export class ChatSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chunkService: ChunkService,
    private readonly ragService: RagService,
  ) {}

  async create(createChatSessionDto: CreateChatSessionDto) {
    if (!createChatSessionDto.projectId && !createChatSessionDto.videoId) {
      throw new BadRequestException(
        'Either projectId or videoId is required to create a chat session',
      );
    }

    try {
      const data = {
        title: createChatSessionDto.title,
        projectId: createChatSessionDto.projectId ?? null,
        videoId: createChatSessionDto.videoId ?? null,
      };

      return await this.prisma.chatSession.create({
        data,
      });
    } catch (error) {
      this.handlePrismaError(
        error,
        createChatSessionDto.projectId ?? createChatSessionDto.videoId,
      );
    }
  }

  findAll(projectId?: string, videoId?: string) {
    return this.prisma.chatSession.findMany({
      where:
        projectId || videoId
          ? {
              ...(projectId ? { projectId } : {}),
              ...(videoId ? { videoId } : {}),
            }
          : undefined,
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const chatSession = await this.prisma.chatSession.findUnique({
      where: {
        id,
      },
    });

    if (!chatSession) {
      throw new NotFoundException(`ChatSession with id "${id}" not found`);
    }

    return chatSession;
  }

  async update(id: string, updateChatSessionDto: UpdateChatSessionDto) {
    try {
      const data = {
        ...(updateChatSessionDto.title !== undefined
          ? { title: updateChatSessionDto.title }
          : {}),
        ...(updateChatSessionDto.projectId !== undefined
          ? { projectId: updateChatSessionDto.projectId }
          : {}),
        ...(updateChatSessionDto.videoId !== undefined
          ? { videoId: updateChatSessionDto.videoId }
          : {}),
      };

      return await this.prisma.chatSession.update({
        where: {
          id,
        },
        data,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.chatSession.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  findMessages(sessionId: string) {
    return this.prisma.chatMessage.findMany({
      where: {
        sessionId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });
  }

  async ask(sessionId: string, content: string) {
    if (!sessionId || !content?.trim()) {
      throw new BadRequestException('sessionId and content are required');
    }

    const session = await this.findOne(sessionId);
    const question = content.trim();

    const userMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'user',
        content: question,
      },
    });

    let answer: string;
    let retrievedChunks: Prisma.InputJsonValue[] = [];
    let groundedChunks: Awaited<
      ReturnType<ChunkService['ensureTranscriptChunks']>
    > = [];

    try {
      if (session.videoId) {
        const transcript = await this.prisma.transcript.findFirst({
          where: {
            videoId: session.videoId,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (transcript) {
          groundedChunks = await this.chunkService.ensureTranscriptChunks(
            session.videoId,
            transcript.id,
            transcript.rawText,
          );
          await this.ragService.ingestTranscriptText(
            groundedChunks.map((chunk) => chunk.content).join('\n\n'),
            {
              source: 'video_chunks',
              videoId: session.videoId,
              transcriptId: transcript.id,
              chunkCount: groundedChunks.length,
            },
          );
        }
      }

      if (groundedChunks.length > 0) {
        retrievedChunks = this.rankChunksForQuestion(question, groundedChunks)
          .slice(0, 4)
          .map(({ chunk, score }, index) => ({
            citationId: `S${index + 1}`,
            source: 'chunk',
            chunkId: chunk.id,
            chunkIndex: chunk.chunkIndex,
            score,
            cosineScore: 0,
            keywordScore: score,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
            startChar: chunk.startChar,
            endChar: chunk.endChar,
            videoId: session.videoId,
            projectId: session.projectId,
          }));
      }

      const result = await this.ragService.answerQuestion(question);
      answer = result.answer;
      if (retrievedChunks.length === 0) {
        retrievedChunks = result.sources.map((source, index) => ({
          citationId: `S${index + 1}`,
          source: 'chunk',
          score: 0,
          cosineScore: 0,
          keywordScore: 0,
          content: String(source),
          videoId: session.videoId,
          projectId: session.projectId,
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      answer =
        'RAG could not generate an answer right now. Please check GROQ_API_KEY and rebuild the transcript index. Detail: ' +
        this.sanitizeProviderError(message);
    }

    const assistantMessage = await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: answer,
        retrievedChunks,
      },
    });

    await this.prisma.chatSession.update({
      where: {
        id: sessionId,
      },
      data: {
        updatedAt: new Date(),
      },
    });

    return {
      sessionId,
      videoId: session.videoId,
      projectId: session.projectId,
      question,
      answer,
      modelUsed: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
      userMessage,
      assistantMessage,
      retrievedChunks,
    };
  }

  private sanitizeProviderError(message: string) {
    return message.replace(/gsk_[A-Za-z0-9_-]+/g, 'gsk_***');
  }

  private rankChunksForQuestion(
    question: string,
    chunks: Awaited<ReturnType<ChunkService['ensureTranscriptChunks']>>,
  ) {
    const queryTerms = new Set(
      this.normalizeForSearch(question)
        .split(/\s+/)
        .filter((term) => term.length >= 3),
    );

    return chunks
      .map((chunk) => {
        const content = this.normalizeForSearch(chunk.content);
        let score = 0;

        for (const term of queryTerms) {
          if (content.includes(term)) {
            score += 1;
          }
        }

        return {
          chunk,
          score,
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.chunk.chunkIndex - right.chunk.chunkIndex,
      );
  }

  private normalizeForSearch(value: string) {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2003') {
        throw new NotFoundException(
          `Related project or video with id "${id}" not found`,
        );
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`ChatSession with id "${id}" not found`);
      }
    }

    throw error;
  }
}
