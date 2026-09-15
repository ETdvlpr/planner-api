import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** Any Prisma client or interactive-transaction client. */
export type PrismaLike = Pick<PrismaService, '$queryRaw'>;

/**
 * Allocates the per-user sync sequence.
 *
 * Every write that a client could later need to learn about goes through here —
 * domain CRUD from the web app just as much as a sync push. A row written
 * without a fresh `seq` is invisible to `GET /sync/pull` forever, which is the
 * single easiest way to make this system quietly lose data.
 */
@Injectable()
export class SeqService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reserves `count` numbers and returns the value immediately **before** the
   * reserved block, so callers pre-increment (`seq += 1n`).
   */
  async allocate(
    userId: string,
    count = 1,
    client: PrismaLike = this.prisma,
  ): Promise<bigint> {
    const rows = await client.$queryRaw<{ last_seq: bigint }[]>`
      INSERT INTO sync_state (user_id, last_seq, updated_at)
      VALUES (${userId}::uuid, ${count}::bigint, now())
      ON CONFLICT (user_id)
        DO UPDATE SET last_seq = sync_state.last_seq + ${count}::bigint,
                      updated_at = now()
      RETURNING last_seq
    `;
    return rows[0].last_seq - BigInt(count);
  }

  /** The next single sequence number. */
  async next(
    userId: string,
    client: PrismaLike = this.prisma,
  ): Promise<bigint> {
    return (await this.allocate(userId, 1, client)) + 1n;
  }
}
