import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { IsString } from 'class-validator';
import { Roles } from '@common/decorators/roles.decorator';
import { AdminExperienceService } from './admin-experience.service';

/**
 * The global pipe runs with `forbidNonWhitelisted`, so this has to be declared
 * or the request 400s before it reaches the service.
 */
class SetProductDto {
  @IsString()
  productId!: string;
}

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

  /**
   * Parent accounts an admin can attach an orphan scholar to.
   *
   * Separate from `users?role=PARENT` because the picker needs each parent's
   * plan state beside their name — attaching a child to the wrong Sterling is
   * exactly the class of mistake this change exists to prevent.
   */
  @Get('parents')
  async parents(
    @Query('search') search?: string,
  ): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['listLinkableParents']>> }> {
    const data = await this.adminExperienceService.listLinkableParents(search);
    return { success: true, data };
  }

  /**
   * Correct which product an account is on.
   *
   * A correction, not a grant: it writes the product name and its seat count and
   * leaves `planStatus` alone. If the account has no active plan the response
   * says so rather than leaving an admin believing they granted access.
   */
  @Patch('users/:id/product')
  async setProduct(
    @Param('id') id: string,
    @Body() body: SetProductDto,
  ): Promise<{ success: true; data: Awaited<ReturnType<AdminExperienceService['setProduct']>> }> {
    const data = await this.adminExperienceService.setProduct(id, body.productId);
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
