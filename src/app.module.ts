import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import configuration from '@config/configuration';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { EventsModule } from './events/events.module';
import { ExperienceModule } from './experience/experience.module';
import { AIRouterModule } from './intelligence/ai-router/ai-router.module';
import { AITutorModule } from './intelligence/ai-tutor/ai-tutor.module';
import { InstructorAssistantModule } from './intelligence/instructor-assistant/instructor-assistant.module';
import { MasteryEngineModule } from './intelligence/mastery-engine/mastery-engine.module';
import { PacingEngineModule } from './intelligence/pacing-engine/pacing-engine.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { AuthModule } from '@modules/auth/auth.module';
import { AssignmentsModule } from '@modules/assignments/assignments.module';
import { ClassroomsModule } from '@modules/classrooms/classrooms.module';
import { CoursesModule } from '@modules/courses/courses.module';
import { FilesModule } from '@modules/files/files.module';
import { GradesModule } from '@modules/grades/grades.module';
import { HealthModule } from '@modules/health/health.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { SubmissionsModule } from '@modules/submissions/submissions.module';
import { UsersModule } from '@modules/users/users.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PassportModule,
    PrismaModule,
    ExperienceModule,
    AIRouterModule,
    AITutorModule,
    InstructorAssistantModule,
    MasteryEngineModule,
    PacingEngineModule,
    EventsModule,
    AttendanceModule,
    AuthModule,
    AssignmentsModule,
    FilesModule,
    SubmissionsModule,
    GradesModule,
    MessagingModule,
    NotificationsModule,
    HealthModule,
    UsersModule,
    OrganizationsModule,
    ClassroomsModule,
    CoursesModule,
    OrchestrationModule,
  ],
  providers: [
    Reflector,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
