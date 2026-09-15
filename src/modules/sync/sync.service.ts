import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SyncRegistry, type TableSchema } from './sync-registry';
import type {
  SyncChangeDto,
  SyncConflict,
  SyncPullResult,
  SyncPushDto,
  SyncPushResult,
} from './sync.dto';

/**
 * The subset of a Prisma delegate this service uses. Every syncable model has
 * the same shape, which is what lets one code path serve fourteen tables.
 */
interface SyncDelegate {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
}

/**
 * A Prisma client that may or may not be inside a transaction. The service runs
 * the same code against both.
 */
type TxClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: SyncRegistry,
    private readonly config: ConfigService,
  ) {}

  // ───────────────────────────────────────────────────────────────── pull

  /**
   * Everything that changed for this user after `since`.
   *
   * Each table is queried for its own `limit` smallest rows above the cursor;
   * the results are merged, sorted by `seq` and truncated to `limit`. That is
   * what makes the returned cursor safe to resume from: every row in
   * `(since, cursor]` is present, because a table with more than `limit` rows
   * in range still returned all of its rows below its own `limit`-th, and the
   * merged cursor can never exceed that.
   */
  async pull(
    userId: string,
    since: bigint,
    limit: number,
    deviceId?: string,
  ): Promise<SyncPullResult> {
    const cap = Math.min(
      limit,
      this.config.get<number>('sync.maxPullRows') ?? 500,
    );

    const collected: {
      table: string;
      seq: bigint;
      row: Record<string, unknown>;
    }[] = [];

    // True when at least one table had more rows in range than it returned. A
    // single table can saturate the limit on its own, in which case the merged
    // set is exactly `cap` rows and counting alone would wrongly report that
    // the client is up to date — and it would stop pulling, one page in.
    let truncated = false;

    for (const table of this.registry.tables) {
      const rows = await this.delegate(this.prisma, table).findMany({
        where: { userId, seq: { gt: since } },
        orderBy: { seq: 'asc' },
        // One more than needed, purely to detect that there is more.
        take: cap + 1,
      });
      if (rows.length > cap) {
        truncated = true;
        rows.length = cap;
      }
      for (const row of rows) {
        collected.push({ table: table.name, seq: row.seq as bigint, row });
      }
    }

    collected.sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
    const page = collected.slice(0, cap);
    const hasMore = truncated || collected.length > cap;

    const changes: Record<string, Record<string, unknown>[]> = {};
    for (const entry of page) {
      (changes[entry.table] ??= []).push(entry.row);
    }

    const cursor = page.length > 0 ? page[page.length - 1].seq : since;

    if (deviceId) {
      await this.touchClient(userId, deviceId, {
        lastPulledSeq: cursor,
        lastPulledAt: new Date(),
      });
    }

    return {
      changes,
      cursor: cursor.toString(),
      hasMore,
      count: page.length,
    };
  }

  // ───────────────────────────────────────────────────────────────── push

  /**
   * Applies a batch of client changes.
   *
   * Conflict rule: last writer wins, compared on `updatedAt`, and **the server
   * wins ties**. A tie means two devices claim the same modification instant;
   * picking the stored row makes the outcome identical no matter which device
   * pushes first, which is worth more than picking the "right" one.
   *
   * The whole batch runs in one transaction. A partially applied push would
   * leave the client's outbox believing rows landed that did not, and the only
   * way it would ever find out is a user noticing missing data.
   */
  async push(userId: string, dto: SyncPushDto): Promise<SyncPushResult> {
    const ordered = this.orderChanges(dto.changes);
    const conflicts: SyncConflict[] = [];
    let applied = 0;

    const cursor = await this.prisma.$transaction(
      async (tx) => {
        // One allocation for the batch: N round trips to bump a counter would
        // dominate the cost of the writes themselves.
        let seq = await this.allocateSeq(tx, userId, ordered.length);

        for (const change of ordered) {
          const table = this.registry.get(change.table);
          const delegate = this.delegate(tx, table);
          const incomingUpdatedAt = new Date(change.updatedAt);

          const existing = await delegate.findFirst({
            where: { id: change.id },
            select: { id: true, userId: true, updatedAt: true },
          });

          if (existing && existing.userId !== userId) {
            // Another account already owns this id. Never overwrite it, and
            // never confirm it exists either.
            conflicts.push({
              table: change.table,
              id: change.id,
              reason: 'not_owned',
              serverUpdatedAt: null,
            });
            continue;
          }

          if (existing) {
            const serverUpdatedAt = existing.updatedAt as Date;
            if (serverUpdatedAt >= incomingUpdatedAt) {
              conflicts.push({
                table: change.table,
                id: change.id,
                reason: 'stale',
                serverUpdatedAt: serverUpdatedAt.toISOString(),
              });
              continue;
            }
          }

          seq += 1n;

          if (change.op === 'delete') {
            if (!existing) continue; // deleting something we never had is a no-op
            await delegate.update({
              where: { id: change.id },
              data: {
                deletedAt: new Date(),
                updatedAt: incomingUpdatedAt,
                seq,
              },
            });
            applied += 1;
            continue;
          }

          const data = this.registry.coerce(table, change.data ?? {}, {
            forCreate: !existing,
          });

          if (existing) {
            await delegate.update({
              where: { id: change.id },
              data: {
                ...data,
                // An upsert of a row the client still has is also an
                // undelete: the client is asserting the row is live.
                deletedAt: null,
                updatedAt: incomingUpdatedAt,
                seq,
              },
            });
          } else {
            await delegate.create({
              data: {
                ...data,
                id: change.id,
                userId,
                updatedAt: incomingUpdatedAt,
                seq,
              },
            });
          }
          applied += 1;
        }

        return seq;
      },
      { timeout: 30_000 },
    );

    await this.touchClient(userId, dto.deviceId, {
      platform: dto.platform,
      appVersion: dto.appVersion,
      lastPushedAt: new Date(),
    });

    return {
      applied,
      skipped: ordered.length - applied,
      conflicts,
      cursor: cursor.toString(),
    };
  }

  // ────────────────────────────────────────────────────────────── internals

  /**
   * Reserves `count` sequence numbers and returns the value *before* the block,
   * so callers pre-increment.
   *
   * `UPDATE … RETURNING` takes a row lock for the duration of the transaction,
   * which is exactly the serialisation we want: two concurrent pushes from the
   * same account queue, and neither can interleave sequence numbers with the
   * other's writes.
   */
  private async allocateSeq(
    tx: TxClient,
    userId: string,
    count: number,
  ): Promise<bigint> {
    const rows = await tx.$queryRaw<{ last_seq: bigint }[]>`
      INSERT INTO sync_state (user_id, last_seq, updated_at)
      VALUES (${userId}::uuid, ${count}::bigint, now())
      ON CONFLICT (user_id)
        DO UPDATE SET last_seq = sync_state.last_seq + ${count}::bigint,
                      updated_at = now()
      RETURNING last_seq
    `;
    return rows[0].last_seq - BigInt(count);
  }

  /** Sorts a batch so parents are written before the rows that point at them. */
  private orderChanges(changes: SyncChangeDto[]): SyncChangeDto[] {
    return [...changes].sort((a, b) => {
      const orderA = this.registry.get(a.table).order;
      const orderB = this.registry.get(b.table).order;
      if (orderA !== orderB) return orderA - orderB;
      return a.updatedAt.localeCompare(b.updatedAt);
    });
  }

  private delegate(client: TxClient, table: TableSchema): SyncDelegate {
    return (client as unknown as Record<string, SyncDelegate>)[table.delegate];
  }

  /** Best-effort device bookkeeping — never fails a sync that already landed. */
  private async touchClient(
    userId: string,
    deviceId: string,
    data: Prisma.SyncClientUpdateInput,
  ): Promise<void> {
    try {
      await this.prisma.syncClient.upsert({
        where: { userId_deviceId: { userId, deviceId } },
        update: data,
        create: {
          userId,
          deviceId,
          platform: typeof data.platform === 'string' ? data.platform : null,
          appVersion:
            typeof data.appVersion === 'string' ? data.appVersion : null,
          lastPulledSeq:
            typeof data.lastPulledSeq === 'bigint' ? data.lastPulledSeq : 0n,
          lastPulledAt:
            data.lastPulledAt instanceof Date ? data.lastPulledAt : null,
          lastPushedAt:
            data.lastPushedAt instanceof Date ? data.lastPushedAt : null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not record sync client ${deviceId}: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
  }

  /** Current cursor for a user, for the status endpoint. */
  async status(userId: string) {
    const [state, clients] = await Promise.all([
      this.prisma.syncState.findUnique({ where: { userId } }),
      this.prisma.syncClient.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      cursor: (state?.lastSeq ?? 0n).toString(),
      tables: this.registry.tables.map((t) => t.name),
      clients: clients.map((c) => ({
        deviceId: c.deviceId,
        platform: c.platform,
        appVersion: c.appVersion,
        lastPulledSeq: c.lastPulledSeq.toString(),
        lastPulledAt: c.lastPulledAt,
        lastPushedAt: c.lastPushedAt,
        behindBy: ((state?.lastSeq ?? 0n) - c.lastPulledSeq).toString(),
      })),
    };
  }
}
