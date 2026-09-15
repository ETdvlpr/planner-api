import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { RecurrenceService } from '../modules/recurrence/recurrence.service';

/**
 * Creates any recurring occurrence that a completion should have produced but
 * did not — a task completed offline on a device that has not synced since.
 *
 * Run from a systemd timer, not an in-process cron. The process starts, does
 * its work, and exits, so it costs nothing between runs. On a box where memory
 * is the binding constraint that difference is the whole argument.
 */
async function main() {
  const logger = new Logger('materialise-recurrence');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error', 'log'],
  });

  try {
    const horizonDays = parseInt(process.argv[2] ?? '1', 10);
    const result = await app
      .get(RecurrenceService)
      .materialiseDueSeries(horizonDays);
    logger.log(`Created ${result.created} occurrence(s)`);
  } catch (error) {
    logger.error(
      `Recurrence sweep failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
