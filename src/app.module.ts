import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { TranscriptModule } from './transcript/transcript.module';
import { VideoModule } from './video/video.module';

@Module({
  imports: [PrismaModule, VideoModule, TranscriptModule],
})
export class AppModule {}
