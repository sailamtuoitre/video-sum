import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [PrismaModule, VideoModule],
})
export class AppModule {}
