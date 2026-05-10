import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddVideosToProjectDto } from './dto/add-videos-to-project.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createProjectDto: CreateProjectDto) {
    try {
      const { videoIds = [], ...projectData } = createProjectDto;

      return await this.prisma.project.create({
        data: {
          ...projectData,
          videos:
            videoIds.length > 0
              ? {
                  connect: videoIds.map((id) => ({ id })),
                }
              : undefined,
        },
        include: {
          videos: true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, createProjectDto.name);
    }
  }

  findAll() {
    return this.prisma.project.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        videos: {
          select: {
            id: true,
            youtubeId: true,
            title: true,
            status: true,
            projectId: true,
          },
        },
      },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: {
        id,
      },
      include: {
        videos: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with id "${id}" not found`);
    }

    return project;
  }

  async update(id: string, updateProjectDto: UpdateProjectDto) {
    try {
      const { videoIds, ...projectData } = updateProjectDto;

      return await this.prisma.project.update({
        where: {
          id,
        },
        data: {
          ...projectData,
          ...(videoIds
            ? {
                videos: {
                  connect: videoIds.map((videoId) => ({ id: videoId })),
                },
              }
            : {}),
        },
        include: {
          videos: true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async addVideos(id: string, addVideosToProjectDto: AddVideosToProjectDto) {
    try {
      return await this.prisma.project.update({
        where: {
          id,
        },
        data: {
          videos: {
            connect: addVideosToProjectDto.videoIds.map((videoId) => ({
              id: videoId,
            })),
          },
        },
        include: {
          videos: true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.project.delete({
        where: {
          id,
        },
      });
    } catch (error) {
      this.handlePrismaError(error, id);
    }
  }

  async listVideos(id: string) {
    const project = await this.prisma.project.findUnique({
      where: {
        id,
      },
      include: {
        videos: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project with id "${id}" not found`);
    }

    return project.videos;
  }

  private handlePrismaError(error: unknown, id?: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        throw new ConflictException('Project name or related record already exists');
      }

      if (error.code === 'P2003') {
        throw new NotFoundException(`Related project or video with id "${id}" not found`);
      }

      if (error.code === 'P2025') {
        throw new NotFoundException(`Project with id "${id}" not found`);
      }
    }

    throw error;
  }
}
