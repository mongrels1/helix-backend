export class OrganizationEntity {
  id!: string;
  name!: string;
  slug!: string;
  createdAt!: Date;
  memberCount?: number;
}
