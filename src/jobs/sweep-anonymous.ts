import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import { UsersService } from '../modules/users/users.service';

/**
 * Erases guest accounts nobody has used for a while.
 *
 * A guest ("continue as guest" on the web) lives in one browser's IndexedDB.
 * Clearing site data orphans the account with no way back in, and unlike a
 * real account nothing ever prompts anyone to delete it. Same shape as the
 * recurrence sweep: a oneshot under a systemd timer, so it costs nothing
 * between runs.
 *
 * Usage: node dist/jobs/sweep-anonymous.js [days]   (default: GUEST_SWEEP_AFTER_DAYS)
 */
async function main() {
  const logger = new Logger('sweep-anonymous');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error', 'log'],
  });

  try {
    const configured =
      app.get(ConfigService).get<number>('guests.sweepAfterDays') ?? 30;
    const days = parseInt(process.argv[2] ?? `${configured}`, 10);
    const result = await app.get(UsersService).sweepAnonymous(days);
    logger.log(
      `Erased ${result.users} guest account(s) unseen for ${days} day(s), ` +
        `${result.deletedRows} row(s)`,
    );
  } catch (error) {
    logger.error(
      `Guest sweep failed: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
