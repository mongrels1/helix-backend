import { Module } from '@nestjs/common';
import { ClassroomsModule } from '@modules/classrooms/classrooms.module';
import { CoursesController } from './courses.controller';
import { CoursesRepository } from './courses.repository';
import { CoursesService } from './courses.service';

@Module({
  imports: [ClassroomsModule],
  controllers: [CoursesController],
  providers: [CoursesService, CoursesRepository],
  exports: [CoursesService, CoursesRepository],
})
export class CoursesModule {}
