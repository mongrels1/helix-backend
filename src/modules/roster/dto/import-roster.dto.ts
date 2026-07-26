import { ArrayMaxSize, ArrayMinSize, IsArray } from 'class-validator';

// One parsed CSV row. The frontend reads the uploaded CSV file and posts an array
// of these, so the backend needs no multipart/CSV parsing. Every field is optional
// at the type level; the import service validates the required ones per row and
// reports problems back row-by-row instead of rejecting the whole file.
export interface RosterRowInput {
  name?: string;
  firstName?: string;
  lastName?: string;
  studentId?: string;
  email?: string;
  grade?: string;
}

export class ImportRosterDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(2000)
  rows!: RosterRowInput[];
}
