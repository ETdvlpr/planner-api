import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { SyncRegistry } from '../src/modules/sync/sync-registry';
import { SyncService } from '../src/modules/sync/sync.service';
import type { SyncChangeDto } from '../src/modules/sync/sync.dto';

/**
 * Integration tests for the sync engine, against a real Postgres.
 *
 * The parts worth testing here cannot be tested any other way: sequence
 * allocation is a single `INSERT … ON CONFLICT … RETURNING`, the conflict rule
 * depends on how Postgres compares timestamps, and the pull cursor is only
 * correct if the merge across thirteen tables really does return every row in
 * range. Mocks would prove none of it.
 *
 * Requires TEST_DATABASE_URL; skips itself otherwise so the unit suite still
 * runs anywhere.
 *
 *   createdb planner_test
 *   TEST_DATABASE_URL=postgresql://localhost:5432/planner_test \
 *     npx prisma migrate deploy
 *   npm run test:int
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('sync (integration)', () => {
  let prisma: PrismaService;
  let sync: SyncService;
  let userId: string;

  const config = {
    get: (key: string) =>
      ({ 'sync.maxPullRows': 500, 'sync.maxPushChanges': 500 })[key],
  } as unknown as ConfigService;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    sync = new SyncService(prisma, new SyncRegistry(), config);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        firebaseUid: `test-${randomUUID()}`,
        email: 'test@example.com',
        syncState: { create: {} },
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.checklistItem.deleteMany({ where: { userId } });
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.project.deleteMany({ where: { userId } });
    await prisma.organization.deleteMany({ where: { userId } });
    await prisma.syncClient.deleteMany({ where: { userId } });
    await prisma.syncState.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

  const taskChange = (
    id: string,
    overrides: Partial<SyncChangeDto> = {},
    data: Record<string, unknown> = {},
  ): SyncChangeDto => ({
    table: 'tasks',
    id,
    op: 'upsert',
    updatedAt: iso(),
    data: {
      title: 'Capture something',
      type: 'admin',
      status: 'inbox',
      priority: 'p2',
      createdAt: iso(-1000),
      ...data,
    },
    ...overrides,
  });

  it('applies a push and echoes it back on pull', async () => {
    const id = randomUUID();
    const result = await sync.push(userId, {
      deviceId: 'phone-1',
      changes: [taskChange(id)],
    });

    expect(result.applied).toBe(1);
    expect(result.conflicts).toEqual([]);

    const pulled = await sync.pull(userId, 0n, 100);
    expect(pulled.count).toBe(1);
    expect(pulled.changes.tasks).toHaveLength(1);
    expect(pulled.changes.tasks[0].id).toBe(id);
    expect(pulled.cursor).toBe(result.cursor);
  });

  it('scopes ownership to the token, ignoring any userId the client sends', async () => {
    const id = randomUUID();
    const other = await prisma.user.create({
      data: { firebaseUid: `other-${randomUUID()}` },
    });

    await sync.push(userId, {
      deviceId: 'phone-1',
      changes: [taskChange(id, {}, { userId: other.id })],
    });

    const stored = await prisma.task.findUnique({ where: { id } });
    expect(stored?.userId).toBe(userId);

    await prisma.task.deleteMany({ where: { id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it('refuses to overwrite a row owned by someone else', async () => {
    const id = randomUUID();
    const other = await prisma.user.create({
      data: { firebaseUid: `other-${randomUUID()}`, syncState: { create: {} } },
    });
    await sync.push(other.id, {
      deviceId: 'their-phone',
      changes: [taskChange(id)],
    });

    const result = await sync.push(userId, {
      deviceId: 'phone-1',
      changes: [taskChange(id, {}, { title: 'Stolen' })],
    });

    expect(result.applied).toBe(0);
    expect(result.conflicts).toEqual([
      { table: 'tasks', id, reason: 'not_owned', serverUpdatedAt: null },
    ]);
    const stored = await prisma.task.findUnique({ where: { id } });
    expect(stored?.title).toBe('Capture something');
    expect(stored?.userId).toBe(other.id);

    await prisma.task.deleteMany({ where: { userId: other.id } });
    await prisma.syncState.deleteMany({ where: { userId: other.id } });
    await prisma.syncClient.deleteMany({ where: { userId: other.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  describe('conflict resolution', () => {
    it('accepts a newer write', async () => {
      const id = randomUUID();
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(id, { updatedAt: iso(-60_000) })],
      });

      const result = await sync.push(userId, {
        deviceId: 'laptop-1',
        changes: [
          taskChange(id, { updatedAt: iso() }, { title: 'Newer wins' }),
        ],
      });

      expect(result.applied).toBe(1);
      const stored = await prisma.task.findUnique({ where: { id } });
      expect(stored?.title).toBe('Newer wins');
    });

    it('rejects a stale write and reports the timestamp that beat it', async () => {
      const id = randomUUID();
      const winner = iso();
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(id, { updatedAt: winner })],
      });

      const result = await sync.push(userId, {
        deviceId: 'laptop-1',
        changes: [
          taskChange(id, { updatedAt: iso(-60_000) }, { title: 'Stale' }),
        ],
      });

      expect(result.applied).toBe(0);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].reason).toBe('stale');
      expect(result.conflicts[0].serverUpdatedAt).toBe(
        new Date(winner).toISOString(),
      );

      const stored = await prisma.task.findUnique({ where: { id } });
      expect(stored?.title).toBe('Capture something');
    });

    it('gives ties to the server, so both devices agree on the outcome', async () => {
      const id = randomUUID();
      const sameMoment = iso();
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(id, { updatedAt: sameMoment })],
      });

      const result = await sync.push(userId, {
        deviceId: 'laptop-1',
        changes: [
          taskChange(id, { updatedAt: sameMoment }, { title: 'Tie-breaker' }),
        ],
      });

      expect(result.applied).toBe(0);
      const stored = await prisma.task.findUnique({ where: { id } });
      expect(stored?.title).toBe('Capture something');
    });
  });

  describe('deletes', () => {
    it('tombstones rather than removing, so peers can learn about it', async () => {
      const id = randomUUID();
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(id, { updatedAt: iso(-60_000) })],
      });

      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [{ table: 'tasks', id, op: 'delete', updatedAt: iso() }],
      });

      const stored = await prisma.task.findUnique({ where: { id } });
      expect(stored).not.toBeNull();
      expect(stored?.deletedAt).toBeInstanceOf(Date);
    });

    it('sends the tombstone to a peer on pull', async () => {
      const id = randomUUID();
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(id, { updatedAt: iso(-60_000) })],
      });
      const afterCreate = await sync.pull(userId, 0n, 100);

      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [{ table: 'tasks', id, op: 'delete', updatedAt: iso() }],
      });

      const pulled = await sync.pull(userId, BigInt(afterCreate.cursor), 100);
      expect(pulled.changes.tasks).toHaveLength(1);
      expect(pulled.changes.tasks[0].deletedAt).not.toBeNull();
    });

    it('treats an upsert of a tombstoned row as an undelete', async () => {
      const id = randomUUID();
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(id, { updatedAt: iso(-120_000) })],
      });
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [
          { table: 'tasks', id, op: 'delete', updatedAt: iso(-60_000) },
        ],
      });

      await sync.push(userId, {
        deviceId: 'laptop-1',
        changes: [taskChange(id, { updatedAt: iso() }, { title: 'Back' })],
      });

      const stored = await prisma.task.findUnique({ where: { id } });
      expect(stored?.deletedAt).toBeNull();
      expect(stored?.title).toBe('Back');
    });

    it('ignores a delete for a row it never had', async () => {
      const result = await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [
          { table: 'tasks', id: randomUUID(), op: 'delete', updatedAt: iso() },
        ],
      });
      expect(result.applied).toBe(0);
      expect(result.conflicts).toEqual([]);
    });
  });

  describe('ordering', () => {
    it('writes a parent before the child that points at it', async () => {
      const projectId = randomUUID();
      const taskId = randomUUID();

      // Deliberately out of order in the batch.
      const result = await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [
          taskChange(taskId, {}, { projectId }),
          {
            table: 'projects',
            id: projectId,
            op: 'upsert',
            updatedAt: iso(),
            data: {
              name: 'Planner backend',
              status: 'active',
              createdAt: iso(-1000),
            },
          },
        ],
      });

      expect(result.applied).toBe(2);

      const project = await prisma.project.findUnique({
        where: { id: projectId },
      });
      const task = await prisma.task.findUnique({ where: { id: taskId } });
      expect(project).not.toBeNull();
      expect(task?.projectId).toBe(projectId);
      // The project was written first, so it carries the lower sequence.
      expect(project!.seq < task!.seq).toBe(true);
    });
  });

  describe('cursors', () => {
    it('is monotonic and per-user', async () => {
      const first = await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(randomUUID())],
      });
      const second = await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(randomUUID())],
      });
      expect(BigInt(second.cursor) > BigInt(first.cursor)).toBe(true);

      const other = await prisma.user.create({
        data: {
          firebaseUid: `other-${randomUUID()}`,
          syncState: { create: {} },
        },
      });
      const theirs = await sync.push(other.id, {
        deviceId: 'their-phone',
        changes: [taskChange(randomUUID())],
      });
      // Their first write is seq 1, regardless of how busy this account is.
      expect(theirs.cursor).toBe('1');

      await prisma.task.deleteMany({ where: { userId: other.id } });
      await prisma.syncState.deleteMany({ where: { userId: other.id } });
      await prisma.syncClient.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    });

    it('returns nothing new when the client is already current', async () => {
      const pushed = await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(randomUUID())],
      });
      const pulled = await sync.pull(userId, BigInt(pushed.cursor), 100);
      expect(pulled.count).toBe(0);
      expect(pulled.hasMore).toBe(false);
      expect(pulled.cursor).toBe(pushed.cursor);
    });

    it('pages without losing or repeating a row', async () => {
      const ids = Array.from({ length: 7 }, () => randomUUID());
      for (const id of ids) {
        await sync.push(userId, {
          deviceId: 'phone-1',
          changes: [taskChange(id)],
        });
      }

      const seen: string[] = [];
      let cursor = 0n;
      for (let page = 0; page < 10; page++) {
        const result = await sync.pull(userId, cursor, 3);
        for (const row of result.changes.tasks ?? []) {
          seen.push(row.id as string);
        }
        cursor = BigInt(result.cursor);
        if (!result.hasMore) break;
      }

      expect(seen.sort()).toEqual([...ids].sort());
    });
  });

  describe('validation', () => {
    it('rejects a row missing a column the schema requires', async () => {
      await expect(
        sync.push(userId, {
          deviceId: 'phone-1',
          changes: [
            {
              table: 'tasks',
              id: randomUUID(),
              op: 'upsert',
              updatedAt: iso(),
              data: { title: 'Only a title' },
            },
          ],
        }),
      ).rejects.toThrow(/Missing required field/);
    });

    it('rolls the whole batch back when one change is invalid', async () => {
      const good = randomUUID();
      await expect(
        sync.push(userId, {
          deviceId: 'phone-1',
          changes: [
            taskChange(good),
            {
              table: 'tasks',
              id: randomUUID(),
              op: 'upsert',
              updatedAt: iso(),
              data: { title: 'Broken', type: 'not-a-type' },
            },
          ],
        }),
      ).rejects.toThrow();

      // A half-applied push is the failure mode that loses data silently: the
      // client's outbox would clear rows the server never stored.
      expect(await prisma.task.findUnique({ where: { id: good } })).toBeNull();
    });
  });

  describe('status', () => {
    it('reports how far each device is behind', async () => {
      await sync.push(userId, {
        deviceId: 'phone-1',
        platform: 'ios',
        changes: [taskChange(randomUUID())],
      });
      await sync.push(userId, {
        deviceId: 'phone-1',
        changes: [taskChange(randomUUID())],
      });

      const status = await sync.status(userId);
      expect(status.cursor).toBe('2');
      const phone = status.clients.find((c) => c.deviceId === 'phone-1');
      expect(phone?.platform).toBe('ios');
      // It has pushed but never pulled, so it is behind by everything.
      expect(phone?.behindBy).toBe('2');
    });
  });
});
