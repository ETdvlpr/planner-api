import * as Joi from 'joi';

/**
 * Environment contract. Anything the app reads from `process.env` belongs here,
 * and anything required is `.required()` — a missing secret must fail at boot,
 * not at the first request that needs it.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3100),
  API_PREFIX: Joi.string().default('api/v1'),
  API_URL: Joi.string().uri().default('http://localhost:3100'),
  ENABLE_SWAGGER: Joi.boolean().truthy('true').falsy('false').default(false),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  TRUST_PROXY: Joi.string().default('1'),

  DATABASE_URL: Joi.string().required(),
  // The box runs seven applications on one vCPU and 1.9 GB. An uncapped Prisma
  // pool is how a background job starves the payments API of connections.
  DATABASE_POOL_SIZE: Joi.number().integer().min(1).max(20).default(5),

  THROTTLE_TTL: Joi.number().default(60_000),
  THROTTLE_LIMIT: Joi.number().default(120),

  // ── Firebase ──────────────────────────────────────────────────────────────
  // Either point at a service-account JSON file or inline the three fields.
  // `verifyIdToken` needs only the project id to check the audience/issuer, but
  // deleting a Firebase user during account erasure needs real credentials.
  FIREBASE_PROJECT_ID: Joi.string().required(),
  FIREBASE_SERVICE_ACCOUNT_PATH: Joi.string().allow('').default(''),
  FIREBASE_CLIENT_EMAIL: Joi.string().allow('').default(''),
  FIREBASE_PRIVATE_KEY: Joi.string().allow('').default(''),

  // ── Object storage (Cloudflare R2, S3-compatible) ─────────────────────────
  STORAGE_ENDPOINT: Joi.string().allow('').default(''),
  STORAGE_REGION: Joi.string().default('auto'),
  STORAGE_BUCKET: Joi.string().allow('').default('planner-media'),
  STORAGE_ACCESS_KEY: Joi.string().allow('').default(''),
  STORAGE_SECRET_KEY: Joi.string().allow('').default(''),
  STORAGE_PUBLIC_BASE_URL: Joi.string().allow('').default(''),
  STORAGE_UPLOAD_URL_TTL: Joi.number().integer().min(60).default(900),
  STORAGE_DOWNLOAD_URL_TTL: Joi.number().integer().min(60).default(3600),
  STORAGE_MAX_UPLOAD_BYTES: Joi.number()
    .integer()
    .min(1)
    .default(25 * 1024 * 1024),

  // ── Sync ──────────────────────────────────────────────────────────────────
  SYNC_MAX_PUSH_CHANGES: Joi.number().integer().min(1).max(5000).default(500),
  SYNC_MAX_PULL_ROWS: Joi.number().integer().min(1).max(5000).default(500),
});

export const appConfig = () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3100', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  apiUrl: process.env.API_URL ?? 'http://localhost:3100',

  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID ?? '',
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? '',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL ?? '',
    privateKey: process.env.FIREBASE_PRIVATE_KEY ?? '',
  },

  storage: {
    endpoint: process.env.STORAGE_ENDPOINT ?? '',
    region: process.env.STORAGE_REGION ?? 'auto',
    bucket: process.env.STORAGE_BUCKET ?? 'planner-media',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.STORAGE_SECRET_KEY ?? '',
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL ?? '',
    uploadUrlTtl: parseInt(process.env.STORAGE_UPLOAD_URL_TTL ?? '900', 10),
    downloadUrlTtl: parseInt(
      process.env.STORAGE_DOWNLOAD_URL_TTL ?? '3600',
      10,
    ),
    maxUploadBytes: parseInt(
      process.env.STORAGE_MAX_UPLOAD_BYTES ?? `${25 * 1024 * 1024}`,
      10,
    ),
  },

  sync: {
    maxPushChanges: parseInt(process.env.SYNC_MAX_PUSH_CHANGES ?? '500', 10),
    maxPullRows: parseInt(process.env.SYNC_MAX_PULL_ROWS ?? '500', 10),
  },
});
