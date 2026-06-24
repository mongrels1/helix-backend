import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class DiagnosticResponseDto {
  @IsString() itemId!: string;
  @IsString() strand!: string;
  @IsString() kc!: string;
  @IsNumber() b!: number;
  @IsString() picked!: string;
  @IsString() answer!: string;
  @IsBoolean() correct!: boolean;
  @IsString() tag!: string;
  @IsInt() position!: number;
}

export class SaveDiagnosticDto {
  @IsOptional() @IsString() studentName?: string;
  @IsOptional() @IsString() grade?: string;
  @IsString() length!: string;
  @IsNumber() theta!: number;
  @IsNumber() se!: number;
  @IsInt() itemsAsked!: number;
  @IsObject() profile!: Record<string, unknown>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiagnosticResponseDto)
  responses!: DiagnosticResponseDto[];
}
