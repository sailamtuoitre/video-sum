import { IsArray, IsUUID } from 'class-validator';

export class AddVideosToProjectDto {
  @IsArray()
  @IsUUID(4, { each: true })
  videoIds: string[];
}
