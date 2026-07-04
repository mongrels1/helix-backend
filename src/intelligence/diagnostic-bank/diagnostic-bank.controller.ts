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

  @Post('generate-from-seeds')
  async generateFromSeeds(
    @Body() body: { seeds: Array<{ stem?: string; standard?: string }> },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.generateFromSeeds(body, req.user?.id);
    return { success: true as const, data };
  }

  @Post('publish')
  async publish() {
    const data = await this.svc.publish();
    return { success: true as const, data };
  }
}
