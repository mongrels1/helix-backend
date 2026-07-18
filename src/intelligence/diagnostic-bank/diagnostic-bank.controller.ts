import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { DiagnosticBankService, type CreateDiagnosticItemDto } from './diagnostic-bank.service';

/**
 * Diagnostic staging bank — Super-Admin authoring/curation surface for the
 * scored diagnostic. Global JwtAuthGuard + RolesGuard apply; restricted to
 * SUPER_ADMIN. The live diagnostic is untouched until items are published.
 */
@Controller('api/v1/admin/diagnostic-bank')
@Roles(Role.SUPER_ADMIN)
export class DiagnosticBankController {
  constructor(private readonly svc: DiagnosticBankService) {}

  @Post('seed')
  async seed() {
    const data = await this.svc.seedFromCode();
    return { success: true as const, data };
  }

  @Get('items')
  async list(@Query() q: { grade?: number; status?: string; strand?: string; take?: number }) {
    const data = await this.svc.list(q);
    return { success: true as const, data };
  }

  @Get('stats')
  async stats() {
    const data = await this.svc.stats();
    return { success: true as const, data };
  }

  @Post('items')
  async create(@Body() body: CreateDiagnosticItemDto, @Req() req: { user?: { id?: string } }) {
    const data = await this.svc.create(body, req.user?.id);
    return { success: true as const, data };
  }

  @Post('items/:id/review')
  async review(
    @Param('id') id: string,
    @Body() body: { action: 'validate' | 'reject' | 'restore' },
  ) {
    const data = await this.svc.review(id, body.action);
    return { success: true as const, data };
  }

  @Post('generate')
  async generate(
    @Body() body: { grade: number; strand: string; count?: number },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.generateForGrade(body, req.user?.id);
    return { success: true as const, data };
  }

  @Post('generate-deterministic')
  async generateDeterministic(
    @Body() body: { grade: number; strand?: string; count?: number },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.generateDeterministic(body, req.user?.id);
    return { success: true as const, data };
  }

  @Post('extract-figures')
  async extractFigures(
    @Body() body: { pages: Array<{ image?: string; stems?: string[] }> },
  ) {
    const data = await this.svc.extractFigures(body);
    return { success: true as const, data };
  }

  @Post('generate-from-seeds')
  async generateFromSeeds(
    @Body() body: { seeds: Array<{ stem?: string; standard?: string; figure?: object }> },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.generateFromSeeds(body, req.user?.id);
    return { success: true as const, data };
  }

  @Post('import')
  async import(
    @Body() body: { items: Array<{ stem?: string; options?: string[]; correct?: number; standard?: string; dok?: number; misconceptions?: string[] }> },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.importItems(body, req.user?.id);
    return { success: true as const, data };
  }

  @Post('reject-all')
  async rejectAll(@Body() body: { grade?: number }) {
    const data = await this.svc.rejectAllDrafts(
      typeof body?.grade === 'number' ? body.grade : Number(body?.grade),
    );
    return { success: true as const, data };
  }

  @Post('restore-all')
  async restoreAll(@Body() body: { grade?: number }) {
    const data = await this.svc.restoreAllRejected(
      typeof body?.grade === 'number' ? body.grade : Number(body?.grade),
    );
    return { success: true as const, data };
  }

  @Post('validate-all')
  async validateAll(@Body() body: { grade?: number }) {
    const data = await this.svc.validateAllDrafts(
      typeof body?.grade === 'number' ? body.grade : Number(body?.grade),
    );
    return { success: true as const, data };
  }

  @Post('delete-rejected')
  async deleteRejected(@Body() body: { grade?: number }) {
    const data = await this.svc.deleteRejected(
      typeof body?.grade === 'number' ? body.grade : Number(body?.grade),
    );
    return { success: true as const, data };
  }

  @Post('publish')
  async publish() {
    const data = await this.svc.publish();
    return { success: true as const, data };
  }
}
