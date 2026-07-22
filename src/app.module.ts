import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import configuration from '@config/configuration';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { MetricsMiddleware } from './common/middleware/metrics.middleware';
import { EventsModule } from './events/events.module';
import { ExperienceModule } from './experience/experience.module';
import { AIRouterModule } from './intelligence/ai-router/ai-router.module';
import { AssistantModule } from './intelligence/assistant/assistant.module';
import { AITutorModule } from './intelligence/ai-tutor/ai-tutor.module';
import { InstructorAssistantModule } from './intelligence/instructor-assistant/instructor-assistant.module';
import { DiagnosticModule } from './intelligence/diagnostic/diagnostic.module';
import { MasteryEngineModule } from './intelligence/mastery-engine/mastery-engine.module';
import { RemediationModule } from './intelligence/remediation/remediation.module';
import { PacingEngineModule } from './intelligence/pacing-engine/pacing-engine.module';
import { ItemGenerationModule } from './intelligence/item-generation/item-generation.module';
import { DiagnosticBankModule } from './intelligence/diagnostic-bank/diagnostic-bank.module';
import { PracticeModule } from './intelligence/practice/practice.module';
import { TtsModule } from './intelligence/tts/tts.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { AuthModule } from '@modules/auth/auth.module';
import { ProvisioningModule } from '@modules/provisioning/provisioning.module';
import { ReferralModule } from '@modules/referral/referral.module';
import { StripeModule } from '@modules/stripe/stripe.module';
import { AssignmentsModule } from '@modules/assignments/assignments.module';
import { ClassroomsModule } from '@modules/classrooms/classrooms.module';
import { CoursesModule } from '@modules/courses/courses.module';
import { FilesModule } from '@modules/files/files.module';
import { GradesModule } from '@modules/grades/grades.module';
import { HealthModule } from '@modules/health/health.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { MetricsModule } from '@modules/metrics/metrics.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { SubmissionsModule } from '@modules/submissions/submissions.module';
import { UsersModule } from '@modules/users/users.module';
import { OrchestrationModule } from './orchestration/orchestration.module';
import { PrismaModule } from './prisma/prisma.module';

import { ReportsModule } from './modules/reports/reports.module';
import { KSportsModule } from '@modules/ksports/ksports.module';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password'],
        customProps: () => ({
          service: 'helix-backend',
          version: process.env.npm_package_version ?? '0.0.1',
          env: process.env.NODE_ENV ?? 'development',
        }),
        serializers: {
          req: (req: { method: string; url: string }) => ({
            method: req.method,
            url: req.url,
          }),
        },
      },
    }),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    ScheduleModule.forRoot(),
    PassportModule,
    PrismaModule,
    MetricsModule,
    ExperienceModule,
    ReferralModule,
    StripeModule,
    ReportsModule,
    AIRouterModule,
    AssistantModule,
    AITutorModule,
    InstructorAssistantModule,
    DiagnosticModule,
    MasteryEngineModule,
    RemediationModule,
    PacingEngineModule,
    ItemGenerationModule,
    DiagnosticBankModule,
    PracticeModule,
    TtsModule,
    EventsModule,
    AttendanceModule,
    KSportsModule,
    AuthModule,
    ProvisioningModule,
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).exclude('metrics').forRoutes('*');
  }
}
