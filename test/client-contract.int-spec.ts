import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../src/database/prisma.service';
import { SyncRegistry } from '../src/modules/sync/sync-registry';
import { SyncService } from '../src/modules/sync/sync.service';
import type { SyncPushDto } from '../src/modules/sync/sync.dto';

/**
 * Replays a push recorded from the real mobile engine.
 *
 * `fixtures/client-push.json` is written by the Flutter test
 * `test/unit/wire_fixture_test.dart`: one row of every replicated table,
 * created through the app's own repositories and serialised by its sync
 * engine. Feeding it through `SyncService.push` unchanged is the only test
 * that proves the two codebases agree on the wire — field names, enum
 * values, timestamp format, which fields the client is allowed to send.
 *
 * Regenerate the fixture whenever the Drift schema changes:
 *
 *   cd ../planner-mobile
 *   WIRE_FIXTURE_OUT=../planner-api/test/fixtures/client-push.json \
 *     flutter test test/unit/wire_fixture_test.dart
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

const FIXTURE = join(__dirname, 'fixtures/client-push.json');

describeDb('mobile client contract (integration)', () => {
  let prisma: PrismaService;
  let sync: SyncService;
  let registry: SyncRegistry;
  let userId: string;

  const config = {
    get: (key: string) =>
      ({ 'sync.maxPullRows': 500, 'sync.maxPushChanges': 500 })[key],
  } as unknown as ConfigService;

  const pushes = JSON.parse(readFileSync(FIXTURE, 'utf8')) as SyncPushDto[];

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    registry = new SyncRegistry();
    sync = new SyncService(prisma, registry, config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        firebaseUid: `contract-${randomUUID()}`,
        email: 'contract@example.com',
        syncState: { create: {} },
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    for (const table of [...registry.tables].reverse()) {
      const delegate = (
        prisma as unknown as Record<
          string,
          { deleteMany(args: unknown): Promise<unknown> }
        >
      )[table.delegate];
      await delegate.deleteMany({ where: { userId } });
    }
    await prisma.syncClient.deleteMany({ where: { userId } });
    await prisma.syncState.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('the fixture covers every replicated table', () => {
    const tables = new Set(
      pushes.flatMap((p) => p.changes.map((c) => c.table)),
    );
    for (const table of registry.tables) {
      expect(tables).toContain(table.name);
    }
  });

  it('accepts a real push from the mobile engine without a single conflict or rejection', async () => {
    let applied = 0;
    for (const push of pushes) {
      const result = await sync.push(userId, push);
      expect(result.conflicts).toEqual([]);
      expect(result.skipped).toBe(0);
      applied += result.applied;
    }
    const sent = pushes.reduce((n, p) => n + p.changes.length, 0);
    expect(applied).toBe(sent);
  });

  it('round-trips through pull with the values the client sent', async () => {
    for (const push of pushes) await sync.push(userId, push);

    const pulled = await sync.pull(userId, 0n, 500);
    expect(pulled.hasMore).toBe(false);

    for (const push of pushes) {
      for (const change of push.changes) {
        const rows = pulled.changes[change.table] ?? [];
        const row = rows.find((r) => r.id === change.id);
        expect(row).toBeDefined();
        expect(row!.deletedAt).toBeNull();
        expect(new Date(row!.updatedAt as Date).toISOString()).toBe(
          change.updatedAt,
        );
        for (const [key, value] of Object.entries(change.data ?? {})) {
          const stored = row![key];
          if (stored instanceof Date) {
            expect(stored.toISOString()).toBe(value);
          } else {
            expect(stored).toEqual(value);
          }
        }
      }
    }
  });

  it('a task can be completed server-side after arriving from a phone', async () => {
    for (const push of pushes) await sync.push(userId, push);
    const task = await prisma.task.findFirst({
      where: { userId, recurringSeriesId: { not: null } },
    });
    expect(task).not.toBeNull();
    // The recurrence rule the phone created is the one the server evaluates.
    const rule = await prisma.recurrenceRule.findFirst({
      where: { userId, id: task!.recurrenceRuleId! },
    });
    expect(rule?.frequency).toBe('monthly');
    expect(rule?.dayOfMonth).toBe(7);
  });
});
