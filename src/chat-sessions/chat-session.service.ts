import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChatSessionDto } from './dto/create-chat-session.dto';
import { UpdateChatSessionDto } from './dto/update-chat-session.dto';

@Injectable()
export class ChatSessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createChatSessionDto: CreateChatSessionDto) {
    try {
      return await this.prisma.chatSession.create({
        data: createChatSessionDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createChatSessionDto.videoId);
    }
  }

  findAll(videoId?: string) {
    return this.prisma.chatSession.findMany({
      where: videoId ? { videoId } : undefined,
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
      return await this.prisma.chatSession.update({
        where: {
          id,
        },
        data: updateChatSessionDto,
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
        throw new NotFoundException(`Video with id "${id}" not found`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`ChatSession with id "${id}" not found`);
      }
    }

    throw error;
  }
}
