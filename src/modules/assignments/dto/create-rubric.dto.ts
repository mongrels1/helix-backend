import { Type } from 'class-transformer';
import { IsArray, IsString, MinLength, ValidateNested } from 'class-validator';
import { CreateRubricCriteriaDto } from './create-rubric-criteria.dto';

export class CreateRubricDto {
  @IsString()
  @MinLength(2)
  title!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRubricCriteriaDto)
  criteria!: CreateRubricCriteriaDto[];
}
