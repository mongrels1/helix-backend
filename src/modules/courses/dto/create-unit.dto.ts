import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateUnitDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsInt()
  @Min(0)
  order!: number;
}
