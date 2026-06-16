import { Module } from '@nestjs/common';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { UsersModule } from '@modules/users/users.module';
import { ClassroomsController } from './classrooms.controller';
import { ClassroomsRepository } from './classrooms.repository';
import { ClassroomsService } from './classrooms.service';

@Module({
  imports: [OrganizationsModule, UsersModule],
  controllers: [ClassroomsController],
  providers: [ClassroomsService, ClassroomsRepository],
  exports: [ClassroomsService, ClassroomsRepository],
})
export class ClassroomsModule {}
