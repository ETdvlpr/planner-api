import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/** What the guard needs, kept small enough to cache by the thousand. */
interface CachedPrincipal {
  id: string;
  firebaseUid: string;
  email: string | null;
  cachedAt: number;
}

/** Claims the guard extracts from a verified token. */
export interface VerifiedClaims {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
}

const PRINCIPAL_CACHE_TTL_MS = 5 * 60 * 1000;
const PRINCIPAL_CACHE_MAX = 1000;

@Injectable()
export class UsersService {
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
    private readonly firebase: FirebaseAdminService,
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
    if (cached && Date.now() - cached.cachedAt < PRINCIPAL_CACHE_TTL_MS) {
      return {
        id: cached.id,
        firebaseUid: cached.firebaseUid,
        email: cached.email,
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
        lastSeenAt: new Date(),
      },
      create: {
        firebaseUid: claims.uid,
        email: claims.email ?? null,
        displayName: claims.name ?? null,
        photoUrl: claims.picture ?? null,
        lastSeenAt: new Date(),
        syncState: { create: {} },
      },
    });

    this.cachePrincipal(user);
    return { id: user.id, firebaseUid: user.firebaseUid, email: user.email };
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

    // Content first, identity last: every domain row is scoped by `user_id`, so
    // a failure part-way leaves an unauthenticatable account, never orphans.
    const deletedRows = await this.prisma.$transaction(async (tx) => {
      let count = 0;
      count += (await tx.checklistItem.deleteMany({ where: { userId } })).count;
      count += (await tx.meetingNoteItem.deleteMany({ where: { userId } }))
        .count;
      count += (await tx.attachment.deleteMany({ where: { userId } })).count;
      count += (await tx.voiceNote.deleteMany({ where: { userId } })).count;
      count += (await tx.activityEntry.deleteMany({ where: { userId } })).count;
      count += (await tx.decision.deleteMany({ where: { userId } })).count;
      count += (await tx.note.deleteMany({ where: { userId } })).count;
      count += (await tx.requirement.deleteMany({ where: { userId } })).count;
      count += (await tx.task.deleteMany({ where: { userId } })).count;
      count += (await tx.meeting.deleteMany({ where: { userId } })).count;
      count += (await tx.recurrenceRule.deleteMany({ where: { userId } }))
        .count;
      count += (await tx.project.deleteMany({ where: { userId } })).count;
      count += (await tx.organization.deleteMany({ where: { userId } })).count;
      await tx.syncClient.deleteMany({ where: { userId } });
      await tx.syncState.deleteMany({ where: { userId } });
      await tx.user.delete({ where: { id: userId } });
      return count;
    });

    return { deletedRows };
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
      cachedAt: Date.now(),
    });
  }
}
