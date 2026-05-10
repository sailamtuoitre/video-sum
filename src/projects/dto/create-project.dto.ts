import { IsArray, IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(1, 200)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(4, { each: true })
  videoIds?: string[];
}
