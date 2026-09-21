import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from '../../common/crud/seq.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { isAnonymous } from '../auth/claims';
import { StorageService } from '../storage/storage.service';
import { SYNC_TABLES } from '../sync/sync-registry';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/** What the guard needs, kept small enough to cache by the thousand. */
interface CachedPrincipal {
  id: string;
  firebaseUid: string;
  email: string | null;
  anonymous: boolean;
  cachedAt: number;
}

/** Claims the guard extracts from a verified token. */
export interface VerifiedClaims {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  anonymous: boolean;
}

const PRINCIPAL_CACHE_TTL_MS = 5 * 60 * 1000;
const PRINCIPAL_CACHE_MAX = 1000;

/**
 * The tables an account owns, children before parents. Used for erasure,
 * where order does not matter to the database (no foreign keys) but does to a
 * reader that sees the transaction half-way.
 */
const OWNED_DELEGATES = [...SYNC_TABLES]
  .sort((a, b) => b.order - a.order)
  .map((t) => t.delegate);

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  /**
   * firebase_uid → Planner principal.
   *
   * Without this every authenticated request costs a `SELECT` before it does
   * any work. Entries expire after five minutes, and the only mutable field
   * they carry (email) is refreshed on that expiry — a stale display email for
   * a few minutes is not worth a query per request on a 1 vCPU box.
   */
  private readonly principals = new Map<string, CachedPrincipal>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SeqService,
    private readonly firebase: FirebaseAdminService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Resolves a verified token's claims to a Planner user, creating the row on
   * first sight.
   *
   * Just-in-time provisioning is what removes a whole registration endpoint:
   * Firebase already ran the sign-up, and the first authenticated request is
   * the earliest moment we have anything worth storing.
   */
  async resolvePrincipal(claims: VerifiedClaims): Promise<AuthenticatedUser> {
    const cached = this.principals.get(claims.uid);
    // A guest who just linked a real sign-in keeps the uid but not the
    // provider; that transition is the one thing worth breaking the TTL for,
    // because it is what clears `anonymous` on the row before the sweep can
    // mistake a fresh account for an abandoned guest.
    if (
      cached &&
      Date.now() - cached.cachedAt < PRINCIPAL_CACHE_TTL_MS &&
      cached.anonymous === claims.anonymous
    ) {
      return {
        id: cached.id,
        firebaseUid: cached.firebaseUid,
        email: cached.email,
        isAnonymous: claims.anonymous,
      };
    }

    const user = await this.prisma.user.upsert({
      where: { firebaseUid: claims.uid },
      // A returning user only has their profile refreshed; `deletedAt` is left
      // alone so an erasure in flight is not undone by a stale token.
      update: {
        email: claims.email ?? null,
        displayName: claims.name ?? null,
        photoUrl: claims.picture ?? null,
        anonymous: claims.anonymous,
        lastSeenAt: new Date(),
      },
      create: {
        firebaseUid: claims.uid,
        email: claims.email ?? null,
        displayName: claims.name ?? null,
        photoUrl: claims.picture ?? null,
        anonymous: claims.anonymous,
        lastSeenAt: new Date(),
        syncState: { create: {} },
      },
    });

    this.cachePrincipal(user);
    return {
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      isAnonymous: claims.anonymous,
    };
  }

  async findById(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; photoUrl?: string },
  ): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data });
  }

  /**
   * Erases the account across both systems, Firebase first.
   *
   * Order matters. Deleting the Postgres row first would leave a live Firebase
   * user whose next request re-provisions a fresh, empty account — the erasure
   * would silently undo itself. Deleting Firebase first makes the worst case a
   * Postgres row with no way to authenticate into it, which the sweep below
   * finishes.
   */
  async deleteAccount(userId: string): Promise<{ deletedRows: number }> {
    const user = await this.findById(userId);

    await this.firebase.deleteUser(user.firebaseUid);
    this.principals.delete(user.firebaseUid);

    const deletedRows = await this.eraseUser(userId);
    return { deletedRows };
  }

  /**
   * Moves everything a guest account owns into the calling account, then
   * erases the guest.
   *
   * This is the merge path for "continue as guest, then sign in to an account
   * that already exists". The common upgrade — linking a provider to the
   * anonymous Firebase user — keeps the uid and needs nothing from this server.
   * Only when the credential is already taken does the client sign in as the
   * existing user and hand us the guest's last ID token as proof it owned the
   * guest session.
   *
   * There are no key collisions to resolve: ids are client-minted UUIDs and
   * ownership is a single denormalised column, so the move is a `user_id`
   * rewrite. What *does* need care is `seq`: every adopted row is stamped with
   * a fresh number from the target's counter, or the target's other devices
   * would never pull it. Soft-deleted guest rows are dropped — no peer of the
   * target ever saw them, so they carry nothing.
   *
   * Unlike `deleteAccount`, the data moves *before* the Firebase user goes. A
   * failed move with a deleted Firebase user is data nobody can reach; a
   * moved account with a lingering Firebase user is an empty account that
   * re-provisions on next use and falls to the sweep.
   */
  async adoptAnonymous(
    target: AuthenticatedUser,
    sourceToken: string,
  ): Promise<{ adoptedRows: number }> {
    if (target.isAnonymous) {
      throw new BadRequestException('Sign in to a real account first');
    }

    let claims;
    try {
      claims = await this.firebase.verifyIdToken(sourceToken);
    } catch {
      throw new UnauthorizedException('Guest token is invalid or expired');
    }
    if (!isAnonymous(claims)) {
      throw new BadRequestException('Only a guest session can be adopted');
    }
    if (claims.uid === target.firebaseUid) {
      throw new BadRequestException('That guest session is this account');
    }

    const source = await this.prisma.user.findUnique({
      where: { firebaseUid: claims.uid },
    });

    let adoptedRows = 0;
    if (source) {
      adoptedRows = await this.prisma.$transaction(async (tx) => {
        let moved = 0;
        for (const table of SYNC_TABLES) {
          const delegate = this.delegate(tx, table.delegate);
          const rows = await delegate.findMany({
            where: { userId: source.id, deletedAt: null },
            select: { id: true },
            orderBy: { seq: 'asc' },
          });
          if (rows.length === 0) continue;

          let seq = await this.seq.allocate(target.id, rows.length, tx);
          for (const row of rows) {
            seq += 1n;
            await delegate.update({
              where: { id: row.id },
              data: { userId: target.id, seq },
            });
          }
          moved += rows.length;
        }
        return moved;
      });

      // Whatever is left under the guest is soft-deleted rows and bookkeeping.
      await this.eraseUser(source.id);
    }

    try {
      await this.firebase.deleteUser(claims.uid);
    } catch (error) {
      this.logger.warn(
        `Guest ${claims.uid} adopted but not deleted in Firebase: ${
          error instanceof Error ? error.message : 'unknown'
        }`,
      );
    }
    this.principals.delete(claims.uid);

    return { adoptedRows };
  }

  /**
   * Erases guest accounts that have not been seen for `olderThanDays`.
   *
   * A guest lives in one browser's IndexedDB; clearing site data orphans the
   * account with no way back in, and nothing else ever cleans it up. Firebase
   * can be configured to delete anonymous users itself, so a uid may already
   * be gone there — that is not an error here.
   */
  async sweepAnonymous(
    olderThanDays: number,
  ): Promise<{ users: number; deletedRows: number }> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const stale = await this.prisma.user.findMany({
      where: {
        anonymous: true,
        OR: [{ lastSeenAt: { lt: cutoff } }, { lastSeenAt: null }],
        createdAt: { lt: cutoff },
      },
      select: { id: true, firebaseUid: true },
    });

    let deletedRows = 0;
    for (const user of stale) {
      try {
        await this.firebase.deleteUser(user.firebaseUid);
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code !== 'auth/user-not-found') throw error;
      }
      this.principals.delete(user.firebaseUid);
      deletedRows += await this.eraseUser(user.id);
    }

    return { users: stale.length, deletedRows };
  }

  /**
   * Deletes every row an account owns, then the account.
   *
   * Content first, identity last: every domain row is scoped by `user_id`, so
   * a failure part-way leaves an unauthenticatable account, never orphans.
   * Objects in R2 go afterwards and best-effort — the bucket is not
   * transactional, and a leaked object costs less than a half-erased account.
   */
  private async eraseUser(userId: string): Promise<number> {
    const objectKeys = await this.ownedObjectKeys(userId);

    const deletedRows = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      for (const delegate of OWNED_DELEGATES) {
        count += (
          await this.delegate(tx, delegate).deleteMany({ where: { userId } })
        ).count;
      }
      await tx.syncClient.deleteMany({ where: { userId } });
      await tx.syncState.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      return count;
    });

    for (const key of objectKeys) {
      try {
        await this.storage.delete(key);
      } catch (error) {
        this.logger.warn(
          `Object ${key} not deleted during erasure: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }

    return deletedRows;
  }

  private async ownedObjectKeys(userId: string): Promise<string[]> {
    const [attachments, voiceNotes] = await Promise.all([
      this.prisma.attachment.findMany({
        where: { userId, objectKey: { not: null } },
        select: { objectKey: true },
      }),
      this.prisma.voiceNote.findMany({
        where: { userId, objectKey: { not: null } },
        select: { objectKey: true },
      }),
    ]);
    return [...attachments, ...voiceNotes]
      .map((r) => r.objectKey)
      .filter((k): k is string => !!k);
  }

  /**
   * A Prisma delegate by name, loosely typed. Every syncable model shares the
   * `id` / `userId` / `seq` / `deletedAt` shape this service relies on; the
   * registry is the authority on which models those are.
   */
  private delegate(
    client: Prisma.TransactionClient,
    name: string,
  ): {
    findMany: (args: {
      where: { userId: string; deletedAt: null };
      select: { id: true };
      orderBy: { seq: 'asc' };
    }) => Promise<{ id: string }[]>;
    update: (args: {
      where: { id: string };
      data: { userId: string; seq: bigint };
    }) => Promise<unknown>;
    deleteMany: (args: {
      where: { userId: string };
    }) => Promise<{ count: number }>;
  } {
    return (client as unknown as Record<string, never>)[name];
  }

  private cachePrincipal(user: User): void {
    if (this.principals.size >= PRINCIPAL_CACHE_MAX) {
      // Cheap eviction: drop the oldest insertion. Map preserves insertion
      // order, and an exact LRU is not worth a second data structure here.
      const oldest = this.principals.keys().next();
      if (!oldest.done) this.principals.delete(oldest.value);
    }
    this.principals.set(user.firebaseUid, {
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email,
      anonymous: user.anonymous,
      cachedAt: Date.now(),
    });
  }
}
