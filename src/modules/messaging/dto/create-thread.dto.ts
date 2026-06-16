import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreateThreadDto {
  @IsString()
  @IsOptional()
  subject?: string;

  @IsArray()
  @IsUUID('4', { each: true })
  @ArrayMinSize(1)
  participantIds!: string[];
}
