import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Roles } from '@common/decorators/roles.decorator';
import { PushMapService } from './push-map.service';
import { ConfirmedExtractionDto, ExtractDto, GenerateDto } from './dto/push-map.dto';
import type { ScoreExtraction } from './push-map.types';

type AuthenticatedUser = { userId: string; role: Role };

/**
 * Push Map builder — mirrors `lesson-plan`: create a job, feed it, generate.
 *
 * Every body is a DTO class, never an interface: the global pipe runs with
 * `whitelist` + `forbidNonWhitelisted`, and an interface carries no metadata, so
 * an interface-typed body arrives empty. See `dto/push-map.dto.ts`.
 *
 * ⚠ **PARENT is deliberately not in @Roles yet.** Letting a family upload their
 * own report is the next phase, and it needs one more thing than a role: a check
 * that the `studentId` they name is a child they are actually linked to via
 * ParentStudentLink. `common/family/family.ts` already answers that question —
 * add the role and the ownership check in the same commit, never separately.
 */
@Controller('api/v1/push-map')
@Roles(Role.TEACHER, Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class PushMapController {
  constructor(private readonly service: PushMapService) {}

  /**
   * Scholars this map can be built for.
   *
   * Declared before `jobs/:id` would matter — `students` is a literal segment on
   * a different path, so there is no collision, but keeping the read-only lookup
   * at the top makes the ordering obvious to whoever adds a route next.
   */
  @Get('students')
  async students(@Query('q') q?: string) {
    return { success: true as const, data: await this.service.searchStudents(q ?? '') };
  }

  @Post('jobs')
  createJob(@CurrentUser() user: AuthenticatedUser): {
    success: true;
    data: { jobId: string };
  } {
    return { success: true, data: this.service.createJob(user.userId) };
  }

  /** Transcribe the uploaded report. What comes back goes to the confirm screen. */
  @Post('jobs/:id/extract')
  async extract(
    @Param('id') id: string,
    @Body() dto: ExtractDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: true; data: ScoreExtraction }> {
    const data = await this.service.extract(id, user.userId, dto);
    return { success: true, data };
  }

  /** What the human confirmed. This is what the map is built from. */
  @Patch('jobs/:id/extraction')
  setExtraction(
    @Param('id') id: string,
    @Body() dto: ConfirmedExtractionDto,
    @CurrentUser() user: AuthenticatedUser,
  ): { success: true; data: ScoreExtraction } {
    const data = this.service.setExtraction(id, user.userId, toExtraction(dto));
    return { success: true, data };
  }

  @Post('jobs/:id/generate')
  async generate(
    @Param('id') id: string,
    @Body() dto: GenerateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const data = await this.service.generate(id, user.userId, dto.studentId);
    return { success: true as const, data };
  }

  @Get('jobs/:id')
  getMap(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return { success: true as const, data: this.service.getMap(id, user.userId) };
  }
}

/**
 * DTO → domain contract.
 *
 * `class-validator` leaves an omitted optional property `undefined`; the
 * extraction contract is explicit about absence being `null`, because "nobody
 * could read this" is a state the confirm screen and the composer both act on.
 * Normalising here keeps that distinction from leaking into the service.
 */
function toExtraction(dto: ConfirmedExtractionDto): ScoreExtraction {
  return {
    vendor: dto.vendor,
    assessmentName: dto.assessmentName ?? null,
    takenOn: dto.takenOn ?? null,
    studentGrade: dto.studentGrade ?? null,
    overall: {
      score: dto.overall?.score ?? null,
      label: dto.overall?.label ?? null,
      standardError: dto.overall?.standardError ?? null,
    },
    percentile: dto.percentile ?? null,
    domains: (dto.domains ?? []).map((d) => ({
      name: d.name,
      score: d.score ?? null,
      label: d.label ?? null,
      strand: d.strand ?? null,
    })),
    growthTargets: {
      typical: dto.growthTargets?.typical ?? null,
      stretch: dto.growthTargets?.stretch ?? null,
    },
    unreadable: dto.unreadable ?? [],
  };
}
