import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSummaryDto } from './dto/create-summary.dto';
import { UpdateSummaryDto } from './dto/update-summary.dto';

@Injectable()
export class SummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createSummaryDto: CreateSummaryDto) {
    try {
      return await this.prisma.summary.create({
        data: createSummaryDto,
      });
    } catch (error) {
      this.handlePrismaError(error, createSummaryDto.videoId);
    }
  }

  findAll(videoId?: string) {
    return this.prisma.summary.findMany({
      where: videoId ? { videoId } : undefined,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string) {
    const summary = await this.prisma.summary.findUnique({
      where: {
        id,
      },
    });

    if (!summary) {
      throw new NotFoundException(`Summary with id "${id}" not found`);
    }

    return summary;
  }

  async update(id: string, updateSummaryDto: UpdateSummaryDto) {
    try {
      return await this.prisma.summary.update({
        where: {
          id,
        },
        data: updateSummaryDto,
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.summary.delete({
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
      if (error.code === 'P2002') {
        throw new ConflictException('Summary for this video already exists');
      }

      if (error.code === 'P2003') {
        throw new NotFoundException(`Video with id "${id}" not found`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Summary with id "${id}" not found`);
      }
    }

    throw error;
  }
}
