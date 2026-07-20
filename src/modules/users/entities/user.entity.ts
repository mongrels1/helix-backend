import { Role } from '@prisma/client';

export class UserEntity {
  id!: string;
  email!: string;
  role!: Role;
  plan!: string | null;
  planStatus!: string | null;
  planRenewsAt!: Date | null;
  maxStudents!: number | null;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
  suspendedAt!: Date | null;
  profile!: {
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  } | null;
}
