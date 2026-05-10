import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { UpdateChatSessionDto } from './dto/update-chat-session.dto';

@Injectable()
export class ChatSessionService {
  constructor(private readonly prisma: PrismaService) {}

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
