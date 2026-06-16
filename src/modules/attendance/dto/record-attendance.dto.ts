import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsUUID, ValidateNested } from 'class-validator';
import { AttendanceEntryDto } from './attendance-entry.dto';

export class RecordAttendanceDto {
  @IsUUID()
  classroomId!: string;

  @IsDateString()
  date!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries!: AttendanceEntryDto[];
}
