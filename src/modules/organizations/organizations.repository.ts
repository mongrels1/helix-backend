import { Injectable } from '@nestjs/common';
import { Membership, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationEntity } from './entities/organization.entity';

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
  _count: {
    select: {
      memberships: true,
    },
  },
};

type OrganizationRecord = {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  _count?: {
    memberships: number;
  };
};

@Injectable()
export class OrganizationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    page: number,
    limit: number,
  ): Promise<[OrganizationEntity[], number]> {
    const skip = (page - 1) * limit;
    const where = { deletedAt: null };

    const [organizations, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        select: organizationSelect,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.organization.count({ where }),
    ]);

    return [organizations.map(this.toEntity), total];
  }

  async findById(id: string): Promise<OrganizationEntity | null> {
    const organization = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: organizationSelect,
    });

    return organization ? this.toEntity(organization) : null;
  }

  async findBySlug(slug: string): Promise<OrganizationEntity | null> {
    const organization = await this.prisma.organization.findFirst({
      where: { slug, deletedAt: null },
      select: organizationSelect,
    });

    return organization ? this.toEntity(organization) : null;
  }

  async create(data: CreateOrganizationDto): Promise<OrganizationEntity> {
    const organization = await this.prisma.organization.create({
      data,
      select: organizationSelect,
    });

    return this.toEntity(organization);
  }

  async update(
    id: string,
    data: UpdateOrganizationDto,
  ): Promise<OrganizationEntity> {
    await this.prisma.organization.updateMany({
      where: { id, deletedAt: null },
      data,
    });

    const organization = await this.findById(id);
    if (!organization) {
      throw new Error('Organization not found');
    }

    return organization;
  }

  async softDelete(id: string): Promise<void> {
    await this.prisma.organization.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  async addMember(
    organizationId: string,
    userId: string,
    role: Role,
  ): Promise<Membership> {
    return this.prisma.membership.upsert({
      where: {
        userId_organizationId: {
          userId,
          organizationId,
        },
      },
      update: { role },
      create: {
        userId,
        organizationId,
        role,
      },
    });
  }

  async removeMember(organizationId: string, userId: string): Promise<void> {
    await this.prisma.membership.deleteMany({
      where: { organizationId, userId },
    });
  }

  async getMembers(organizationId: string): Promise<Membership[]> {
    return this.prisma.membership.findMany({
      where: {
        organizationId,
        organization: { deletedAt: null },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private toEntity(organization: OrganizationRecord): OrganizationEntity {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdAt: organization.createdAt,
      memberCount: organization._count?.memberships,
    };
  }
}
