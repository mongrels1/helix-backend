import { Controller, Post, Get, Delete, Body, Param, Query, Req } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { ItemGenerationService } from './item-generation.service';
import { ValidationService } from './validation.service';
import type { GenerateRequest, GeneratedItem } from './types';

/**
 * Question Bank -> Generate. Super-admin authoring surface.
 * Global JwtAuthGuard + RolesGuard apply; @Roles restricts to SUPER_ADMIN.
 */
@Controller('api/v1/admin/item-gen')
@Roles(Role.SUPER_ADMIN)
export class ItemGenerationController {
  constructor(
    private readonly svc: ItemGenerationService,
    private readonly validation: ValidationService,
  ) {}

  @Post('ingest')
  async ingest(@Body() body: { format: 'pdf' | 'csv' | 'paste'; text?: string }) {
    const data = await this.svc.ingest(body.format, { text: body.text });
    return { success: true as const, data };
  }

  @Post('generate')
  async generate(@Body() body: GenerateRequest, @Req() req: { user?: { id?: string } }) {
    const data = await this.svc.generate(body, req.user?.id ?? 'super-admin');
    return { success: true as const, data };
  }

  @Post('generate-standard')
  async generateFromStandard(
    @Body() body: { standard: string; grade?: number; count?: number },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.generateFromStandard(body, req.user?.id ?? 'super-admin');
    return { success: true as const, data };
  }

  @Post('generate-all-standards')
  async generateAllStandards(
    @Body() body: { standards: string[]; countPerStandard?: number },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.generateAllStandards(body, req.user?.id ?? 'super-admin');
    return { success: true as const, data };
  }

  @Get('jobs/:jobId')
  async job(@Param('jobId') jobId: string) {
    const data = await this.svc.getJob(jobId);
    return { success: true as const, data };
  }

  @Post('validate')
  async validate(@Body() body: { batchId: string }) {
    const data = await this.validation.validateBatch(body.batchId);
    return { success: true as const, data };
  }

  @Get('queue')
  async queue(
    @Query() q: { status?: string; batchId?: string; page?: number; pageSize?: number; search?: string; grade?: string },
  ) {
    const data = await this.svc.queue(q);
    return { success: true as const, data };
  }

  @Get('integrity')
  async integrity() {
    const data = await this.svc.integrity();
    return { success: true as const, data };
  }

  @Get('items/:id')
  async item(@Param('id') id: string) {
    const data = await this.svc.item(id);
    return { success: true as const, data };
  }

  @Delete('drafts')
  async clearDrafts() {
    const data = await this.svc.clearDrafts();
    return { success: true as const, data };
  }

  @Post('backfill-clusters')
  async backfillClusters() {
    const data = await this.svc.backfillClusters();
    return { success: true as const, data };
  }

  @Post('review/:id')
  async review(
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject' | 'edit'; edits?: Partial<GeneratedItem> },
  ) {
    const data = await this.svc.review(id, body.action, body.edits);
    return { success: true as const, data };
  }

  @Post('promote/:id')
  async promote(@Param('id') id: string) {
    const data = await this.svc.promote(id);
    return { success: true as const, data };
  }
}
