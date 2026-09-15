import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { appConfig, validationSchema } from './config/app.config';
import { DatabaseModule } from './database/database.module';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { FirebaseAuthGuard } from './common/guards/firebase-auth.guard';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StorageModule } from './modules/storage/storage.module';
import { RecurrenceModule } from './modules/recurrence/recurrence.module';

import { OrganizationsModule } from './modules/organizations/organizations.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { RequirementsModule } from './modules/requirements/requirements.module';
import { NotesModule } from './modules/notes/notes.module';
import { DecisionsModule } from './modules/decisions/decisions.module';
import { ActivityModule } from './modules/activity/activity.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { VoiceNotesModule } from './modules/voice-notes/voice-notes.module';
import { SyncModule } from './modules/sync/sync.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      validationSchema,
      validationOptions: { allowUnknown: true },
    }),

    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            ttl: parseInt(process.env.THROTTLE_TTL ?? '60000', 10),
            limit: parseInt(process.env.THROTTLE_LIMIT ?? '120', 10),
          },
        ],
      }),
    }),

    DatabaseModule,

    // Infrastructure
    AuthModule,
    UsersModule,
    StorageModule,
    RecurrenceModule,

    // Domain
    OrganizationsModule,
    ProjectsModule,
    TasksModule,
    MeetingsModule,
    RequirementsModule,
    NotesModule,
    DecisionsModule,
    ActivityModule,
    AttachmentsModule,
    VoiceNotesModule,

    SyncModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global: every route is authenticated unless it carries @Public().
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
  ],
})
export class AppModule {}

// Deliberately not here:
//
// `@nestjs/schedule` — a resident scheduler costs memory every minute of the
// day to do work that runs once. Recurrence materialisation is a systemd timer
// invoking `jobs/materialise-recurrence.ts`, matching the geoip timer already
// on this box.
//
// FCM / push notifications — nothing originates server-side in a
// single-user-per-account product. Reminders are already known to the device,
// and the mobile app schedules them locally.
