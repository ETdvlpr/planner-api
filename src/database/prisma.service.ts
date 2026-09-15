import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // The pool size is capped from config rather than left at the driver
    // default: Postgres on this box is shared with six other applications and
    // sits at ~26 of 100 connections before Planner exists.
    const poolSize = parseInt(process.env.DATABASE_POOL_SIZE ?? '5', 10);
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      max: poolSize,
    });

    super({
      adapter,
      log:
        process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to Postgres');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
