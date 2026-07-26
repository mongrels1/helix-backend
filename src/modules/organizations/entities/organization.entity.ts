export class OrganizationEntity {
  id!: string;
  name!: string;
  slug!: string;
  createdAt!: Date;
  memberCount?: number;
  rosterEnabled?: boolean;
  studentEmailInvites?: boolean;
  perTeacherCap?: number | null;
}
