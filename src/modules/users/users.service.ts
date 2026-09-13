import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import { UsersRepository } from './users.repository';
import { isOwnerAccount, isPlanActive } from '../../common/billing/billing';
import { familyDeleteBlock } from '../../common/family/family';

const SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async findAll(
    page = 1,
    limit = 20,
  ): Promise<{ data: UserEntity[]; meta: { page: number; limit: number; total: number } }> {
    const normalizedPage = Math.max(page, 1);
    const normalizedLimit = Math.min(Math.max(limit, 1), 100);
    const [users, total] = await this.usersRepository.findAll(
      normalizedPage,
      normalizedLimit,
    );

    return {
      data: users,
      meta: {
        page: normalizedPage,
        limit: normalizedLimit,
        total,
      },
    };
  }

  async findById(id: string): Promise<UserEntity> {
    const user = await this.usersRepository.findById(id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    return this.usersRepository.create(dto, passwordHash);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findById(id);
    return this.usersRepository.update(id, dto);
  }

  async suspend(id: string): Promise<UserEntity> {
    await this.findById(id);
    await this.usersRepository.suspend(id);
    return this.findById(id);
  }

  async restore(id: string): Promise<UserEntity> {
    await this.findById(id);
    await this.usersRepository.restore(id);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findById(id);
    // The owner account is never billed, so the "no active plan" branch below
    // would happily hard-delete it. Ownership is not a subscription state.
    if (isOwnerAccount(user.role)) {
      throw new BadRequestException('The owner account cannot be deleted.');
    }
    // Household next. A scholar added through a paying parent's "Add a child"
    // button has no plan and no activity of their own on day one, so both tests
    // below pass and the account deletes cleanly — taking the ParentStudentLink
    // with it, because hardDelete() deleteMany's that row before the user row.
    // The admin UI greys the button; this is what makes it actually impossible.
    const family = await this.usersRepository.findFamily(id);
    const familyBlock = familyDeleteBlock(user.role, family);
    if (familyBlock) {
      throw new BadRequestException(familyBlock);
    }

    const activity = await this.usersRepository.countActivity(id);
    const isPaid = isPlanActive(user.planStatus, user.planRenewsAt);
    const hasActivity =
      activity.enrollments > 0 ||
      activity.submissions > 0 ||
      activity.taughtClassrooms > 0 ||
      activity.instructorContent > 0;

    if (isPaid || hasActivity) {
      throw new BadRequestException(
        'This account has enrollments, submissions, taught classrooms, or an active paid subscription and cannot be permanently deleted. Pause it instead.',
      );
    }

    await this.usersRepository.hardDelete(id);
  }

  /** Read-only: how many suspected-bot accounts match, plus a sample to eyeball. */
  async scanSpam(olderThanHours = 24): Promise<{
    count: number;
    olderThanHours: number;
    sample: Array<{ id: string; email: string; name: string; createdAt: Date }>;
  }> {
    const hours = Math.max(1, Math.floor(olderThanHours) || 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const ids = await this.usersRepository.findSpamCandidateIds(cutoff);
    const raw = await this.usersRepository.sampleSpamCandidates(cutoff, 25);
    const sample = raw.map((r) => ({
      id: r.id,
      email: r.email,
      name: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim(),
      createdAt: r.createdAt,
    }));
    return { count: ids.length, olderThanHours: hours, sample };
  }

  /** Soft-delete the suspected-bot accounts. Aborts if the live count no longer
   *  matches what the caller saw at scan time (data changed in between). */
  async purgeSpam(olderThanHours = 24, expectedCount?: number): Promise<{ softDeleted: number; count: number }> {
    const hours = Math.max(1, Math.floor(olderThanHours) || 24);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const ids = await this.usersRepository.findSpamCandidateIds(cutoff);
    if (expectedCount !== undefined && ids.length !== expectedCount) {
      throw new BadRequestException(
        `Matched count changed since the scan (was ${expectedCount}, now ${ids.length}). Re-scan and try again.`,
      );
    }
    const softDeleted = await this.usersRepository.softDeleteMany(ids);
    return { softDeleted, count: ids.length };
  }
}
