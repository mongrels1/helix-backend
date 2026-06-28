import { Controller, Get, Query, Req } from '@nestjs/common';
import { PracticeService } from './practice.service';

/**
 * Student practice surface. No @Roles decorator -> the global RolesGuard allows
 * any authenticated user (the global JwtAuthGuard still requires a valid token),
 * so signed-in students can pull approved practice items.
 */
@Controller('api/v1/practice')
export class PracticeController {
  constructor(private readonly svc: PracticeService) {}

  @Get('items')
  async items(
    @Query() q: { grade?: string; standard?: string; limit?: string },
    @Req() req: { user?: { id?: string } },
  ) {
    const data = await this.svc.items(req.user?.id, q);
    return { success: true as const, data };
  }
}
