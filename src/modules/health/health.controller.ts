import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';

@ApiTags('Health')
// Exempt from rate limiting. A monitor polling every few seconds would
// otherwise trip the throttler and report the service as down — the check
// would become the outage.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness and dependency check' })
  async check() {
    const started = Date.now();
    let database = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const memory = process.memoryUsage();

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      storage: this.storage.configured ? 'configured' : 'not-configured',
      uptimeSeconds: Math.round(process.uptime()),
      // Worth exposing on a box where memory is the binding constraint: the
      // number that matters is whether RSS is drifting, and this is how the
      // deploy script checks it without SSH.
      rssMb: Math.round(memory.rss / 1024 / 1024),
      heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
      latencyMs: Date.now() - started,
    };
  }
}
