import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class ChatDto {
  @IsString()
  prompt!: string;

  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(4096)
  maxTokens?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsIn(['openai', 'gemini', 'claude'])
  preferredProvider?: 'openai' | 'gemini' | 'claude';

  @IsOptional()
  @IsString()
  systemPrompt?: string;
}
