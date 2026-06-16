import { Role } from '@prisma/client';

export class UserEntity {
  id!: string;
  email!: string;
  role!: Role;
  createdAt!: Date;
  updatedAt!: Date;
  deletedAt!: Date | null;
  profile!: {
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
  } | null;
}
