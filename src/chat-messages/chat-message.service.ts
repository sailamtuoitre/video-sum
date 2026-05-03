import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { UpdateChatMessageDto } from './dto/update-chat-message.dto';

@Injectable()
export class ChatMessageService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createChatMessageDto: CreateChatMessageDto) {
    try {
      return await this.prisma.chatMessage.create({
        data: createChatMessageDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createChatMessageDto.sessionId);
    }
  }

  findAll(sessionId?: string) {
    return this.prisma.chatMessage.findMany({
      where: sessionId ? { sessionId } : undefined,
      orderBy: [
        {
          sessionId: 'asc',
        },
        {
          createdAt: 'asc',
        },
      ],
    });
  }

  async findOne(id: string) {
    const chatMessage = await this.prisma.chatMessage.findUnique({
      where: {
        id,
      },
    });

    if (!chatMessage) {
      throw new NotFoundException(`ChatMessage with id "${id}" not found`);
    }

    return chatMessage;
  }

  async update(id: string, updateChatMessageDto: UpdateChatMessageDto) {
    try {
      return await this.prisma.chatMessage.update({
        where: {
          id,
        },
        data: updateChatMessageDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.chatMessage.delete({
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
        throw new NotFoundException('Related chat session not found');
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`ChatMessage with id "${id}" not found`);
      }
    }

    throw error;
  }
}
