import { Module } from '@nestjs/common';
import { ClassroomsModule } from '@modules/classrooms/classrooms.module';
import { CoursesModule } from '@modules/courses/courses.module';
import { AssignmentsController } from './assignments.controller';
import { AssignmentsRepository } from './assignments.repository';
import { AssignmentsService } from './assignments.service';

@Module({
  imports: [ClassroomsModule, CoursesModule],
  controllers: [AssignmentsController],
  providers: [AssignmentsService, AssignmentsRepository],
  exports: [AssignmentsService, AssignmentsRepository],
})
export class AssignmentsModule {}
