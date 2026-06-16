import {
  BadRequestException,
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { AdminExperienceService } from './admin-experience.service';

@Controller('api/v1/experience/admin')
@Roles(Role.ORG_ADMIN, Role.SUPER_ADMIN)
export class AdminExperienceController {
  constructor(private readonly adminExperienceService: AdminExperienceService) {}

  @Get('dashboard')
  async dashboard(): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['getDashboard']>> }> {
    const data = await this.adminExperienceService.getDashboard();
    return { success: true, data };
  }

  @Get('users')
  async users(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('role') role?: string,
    @Query('search') search?: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['getUsers']>> }> {
    const parsedRole = this.parseRole(role);
    const data = await this.adminExperienceService.getUsers(page, limit, parsedRole, search);
    return { success: true, data };
  }

  @Get('organizations')
  async organizations(): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['getOrganizations']>> }> {
    const data = await this.adminExperienceService.getOrganizations();
    return { success: true, data };
  }

  @Get('health')
  async health(): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['getHealth']>> }> {
    const data = await this.adminExperienceService.getHealth();
    return { success: true, data };
  }

  @Get('metrics')
  async metrics(): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['getMetrics']>> }> {
    const data = await this.adminExperienceService.getMetrics();
    return { success: true, data };
  }

  private parseRole(role?: string): Role | undefined {
    if (!role) return undefined;
    if (!Object.values(Role).includes(role as Role)) {
      throw new BadRequestException('Invalid role filter');
    }
    return role as Role;
  }
}
