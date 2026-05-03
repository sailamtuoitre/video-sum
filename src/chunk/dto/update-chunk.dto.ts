import { PartialType } from '@nestjs/mapped-types';
import { CreateChunkDto } from './create-chunk.dto';

export class UpdateChunkDto extends PartialType(CreateChunkDto) {}
