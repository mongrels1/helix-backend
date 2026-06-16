import { IsIn, IsInt, IsString, Max, Min } from 'class-validator';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'video/mp4',
  'audio/mpeg',
  'image/png',
  'image/jpeg',
  'application/zip',
];

export class RequestUploadDto {
  @IsString()
  filename!: string;

  @IsIn(ALLOWED_MIME_TYPES)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(104857600)
  sizeBytes!: number;
}
