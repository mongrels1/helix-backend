import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Membership } from '@prisma/client';
import { UsersRepository } from '@modules/users/users.repository';
import { AddMemberDto } from './dto/add-member.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationEntity } from './entities/organization.entity';
import { OrganizationsRepository } from './organizations.repository';

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly usersRepository: UsersRepository,
  ) {}

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{
    data: OrganizationEntity[];
    meta: { page: number; limit: number; total: number };
  }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [organizations, total] = await this.organizationsRepository.findAll(
      normalizedPage,
      normalizedLimit,
    );

    return {
      data: organizations,
      meta: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
      },
    };
  }

  async findById(id: string): Promise<OrganizationEntity> {
    const organization = await this.organizationsRepository.findById(id);

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return organization;
  }

  async create(dto: CreateOrganizationDto): Promise<OrganizationEntity> {
    const existing = await this.organizationsRepository.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictException('Organization slug already exists');
    }

    return this.organizationsRepository.create(dto);
  }

  async update(
    id: string,
    dto: UpdateOrganizationDto,
  ): Promise<OrganizationEntity> {
    await this.findById(id);

    if (dto.slug) {
      const existing = await this.organizationsRepository.findBySlug(dto.slug);
      if (existing && existing.id !== id) {
        throw new ConflictException('Organization slug already exists');
      }
    }

    return this.organizationsRepository.update(id, dto);
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await this.organizationsRepository.softDelete(id);
  }

  async addMember(
    organizationId: string,
    dto: AddMemberDto,
  ): Promise<Membership> {
    await this.findById(organizationId);

    const user = await this.usersRepository.findById(dto.userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.organizationsRepository.addMember(
      organizationId,
      dto.userId,
      dto.role,
    );
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    await this.findById(organizationId);
    await this.organizationsRepository.removeMember(organizationId, userId);
  }

  async getMembers(organizationId: string): Promise<Membership[]> {
    await this.findById(organizationId);
    return this.organizationsRepository.getMembers(organizationId);
  }
}
