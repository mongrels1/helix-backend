import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Membership, Role } from '@prisma/client';
import { Roles } from '@common/decorators/roles.decorator';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { RosterSettingsDto } from './dto/roster-settings.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationsService } from './organizations.service';

@Controller('api/v1/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  async create(
    @Body() createOrganizationDto: CreateOrganizationDto,
  ): Promise<{ success: true; data: OrganizationEntity }> {
    const organization =
      await this.organizationsService.create(createOrganizationDto);
    return { success: true, data: organization };
  }

  @Get()
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ): Promise<{
    success: true;
    data: OrganizationEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const result = await this.organizationsService.findAll(page, limit);
    return { success: true, ...result };
  }

  @Get(':id')
  async findById(
    @Param('id') id: string,
  ): Promise<{ success: true; data: OrganizationEntity }> {
    const organization = await this.organizationsService.findById(id);
    return { success: true, data: organization };
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateOrganizationDto: UpdateOrganizationDto,
  ): Promise<{ success: true; data: OrganizationEntity }> {
    const organization = await this.organizationsService.update(
      id,
      updateOrganizationDto,
    );
    return { success: true, data: organization };
  }

  // Super-admin only: approve a school for roster uploads and set its per-teacher
  // cap / student-email-invite policy. Separate from the generic PATCH so these
  // gates can never be flipped by a non-super-admin.
  @Patch(':id/roster-settings')
  @Roles(Role.SUPER_ADMIN)
  async updateRosterSettings(
    @Param('id') id: string,
    @Body() dto: RosterSettingsDto,
  ): Promise<{ success: true; data: OrganizationEntity }> {
    const organization = await this.organizationsService.updateRosterSettings(
      id,
      dto,
    );
    return { success: true, data: organization };
  }

  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ success: true; data: null }> {
    await this.organizationsService.remove(id);
    return { success: true, data: null };
  }

  @Post(':id/members')
  async addMember(
    @Param('id') id: string,
    @Body() addMemberDto: AddMemberDto,
  ): Promise<{ success: true; data: Membership }> {
    const membership = await this.organizationsService.addMember(
      id,
      addMemberDto,
    );
    return { success: true, data: membership };
  }

  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
  ): Promise<{ success: true; data: null }> {
    await this.organizationsService.removeMember(id, userId);
    return { success: true, data: null };
  }

  @Get(':id/members')
  async getMembers(
    @Param('id') id: string,
  ): Promise<{ success: true; data: Membership[] }> {
    const members = await this.organizationsService.getMembers(id);
    return { success: true, data: members };
  }
}
