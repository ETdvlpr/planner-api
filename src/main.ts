import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Application } from 'express';
import { AppModule } from './app.module';
import { originMatcher, parseAllowedOrigins } from './config/cors';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // Behind nginx, so the real client IP arrives in X-Forwarded-For. Rate
  // limiting is worthless without this — every request would look like one
  // client, the proxy.
  const trustProxy = process.env.TRUST_PROXY ?? '1';
  const expressApp = app.getHttpAdapter().getInstance() as Application;
  expressApp.set(
    'trust proxy',
    trustProxy === 'true'
      ? true
      : trustProxy === 'false'
        ? false
        : Number.parseInt(trustProxy, 10) || 1,
  );

  // Exact origins plus `*` patterns for Vercel preview deployments; see
  // config/cors.ts. A disallowed origin gets no CORS headers, which is the
  // browser-side refusal — the request itself is still served.
  const allowOrigin = originMatcher(
    parseAllowedOrigins(process.env.CORS_ORIGIN ?? 'http://localhost:3000'),
  );
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => callback(null, allowOrigin(origin)),
    // No cookies anywhere: the only credential is a Firebase ID token in the
    // Authorization header, which is also why CSRF is not a concern here.
    credentials: false,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const apiPrefix = process.env.API_PREFIX ?? 'api/v1';
  app.setGlobalPrefix(apiPrefix, { exclude: ['health'] });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerEnabled =
    process.env.ENABLE_SWAGGER === 'true' ||
    process.env.NODE_ENV !== 'production';

  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Planner API')
      .setDescription(
        [
          'Accounts, domain CRUD and mobile sync for Planner.',
          '',
          '**Authentication.** Every endpoint except `/health` needs a Firebase',
          'ID token: `Authorization: Bearer <token>`. The API never accepts an',
          'owner id from the client — ownership is derived from the verified',
          'token, and every query is scoped by it.',
          '',
          '**Two clients, two shapes.** The web app is cloud-first and uses the',
          'domain endpoints. The mobile app is local-first and uses `/sync`,',
          'which speaks rows rather than resources.',
        ].join('\n'),
      )
      .setVersion('0.1')
      .addBearerAuth({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      })
      .addServer(
        process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 3100}`,
      )
      .addTag('Users', 'Identity and account erasure')
      .addTag('Organizations')
      .addTag('Projects')
      .addTag('Tasks', 'Tasks, subtasks, checklists and recurrence')
      .addTag('Meetings', 'Meetings and the note items derived from them')
      .addTag('Requirements')
      .addTag('Notes')
      .addTag('Decisions')
      .addTag('Activity', 'What actually happened, planned or not')
      .addTag('Attachments')
      .addTag('Voice notes')
      .addTag('Sync', 'Push/pull replication for the local-first mobile app')
      .addTag('Health')
      .build();

    SwaggerModule.setup(
      `${apiPrefix}/docs`,
      app,
      SwaggerModule.createDocument(app, config),
      { swaggerOptions: { persistAuthorization: true } },
    );
  }

  const port = parseInt(process.env.PORT ?? '3100', 10);
  await app.listen(port);

  const logger = new (await import('@nestjs/common')).Logger('Bootstrap');
  logger.log(
    `Planner API on :${port}/${apiPrefix} (${process.env.NODE_ENV ?? 'development'})`,
  );
}

void bootstrap();
