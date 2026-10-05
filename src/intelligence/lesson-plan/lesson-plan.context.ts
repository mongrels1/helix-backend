import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SaveContextDto } from './dto/save-context.dto';

export type SavedContext = { data: SaveContextDto; updatedAt: string };

/**
 * A teacher's saved context sheet, one per account.
 *
 * Raw SQL on purpose: the table is new, and reading it through the generated
 * client would make this file depend on `prisma generate` having been re-run
 * everywhere the code is type-checked.
 */
@Injectable()
export class LessonPlanContextService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<SavedContext | null> {
    const rows = await this.prisma.$queryRaw<{ data: SaveContextDto; updatedAt: Date }[]>`
      SELECT "data", "updatedAt" FROM "LessonPlanContext" WHERE "userId" = ${userId} LIMIT 1
    `;
    const row = rows[0];
    return row ? { data: row.data, updatedAt: row.updatedAt.toISOString() } : null;
  }

  async save(userId: string, dto: SaveContextDto): Promise<SavedContext> {
    // Copy the known fields explicitly so only what the DTO declares is stored.
    const data: SaveContextDto = {
      period: dto.period,
      grade: dto.grade,
      unit: dto.unit,
      teacher: dto.teacher,
      school: dto.school,
      coTeaching: dto.coTeaching,
      groups: dto.groups,
      strategies: dto.strategies,
      instructions: dto.instructions,
    };
    const json = JSON.stringify(data);
    await this.prisma.$executeRaw`
      INSERT INTO "LessonPlanContext" ("userId", "data", "updatedAt")
      VALUES (${userId}, ${json}::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT ("userId")
      DO UPDATE SET "data" = EXCLUDED."data", "updatedAt" = CURRENT_TIMESTAMP
    `;
    return { data, updatedAt: new Date().toISOString() };
  }
}
