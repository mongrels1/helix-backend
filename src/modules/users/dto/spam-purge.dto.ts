import { IsInt, IsOptional, Min } from 'class-validator';

/** Body for the super-admin spam scan/purge. Both fields optional (declared so the
 *  global forbidNonWhitelisted ValidationPipe doesn't 400 them). */
export class SpamPurgeDto {
  /** Only match accounts older than this many hours (default 24). */
  @IsInt()
  @IsOptional()
  @Min(1)
  olderThanHours?: number;

  /** Safety: the count the caller saw during scan. Purge aborts if the live count
   *  no longer matches (data changed between scan and purge). */
  @IsInt()
  @IsOptional()
  @Min(0)
  expectedCount?: number;
}
