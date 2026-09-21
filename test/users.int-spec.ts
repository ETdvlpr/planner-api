import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/database/prisma.service';
import { SeqService } from '../src/common/crud/seq.service';
import { UsersService } from '../src/modules/users/users.service';
import type { FirebaseAdminService } from '../src/modules/auth/firebase-admin.service';
import type { StorageService } from '../src/modules/storage/storage.service';
import type { AuthenticatedUser } from '../src/common/decorators/current-user.decorator';

/**
 * Guest adoption and the guest sweep, against a real Postgres.
 *
 * The property that matters is the one a mock cannot show: after adoption the
 * moved rows carry sequence numbers the target's *other devices* will pull.
 * That is a question about `sync_state` and a range scan, not about a call
 * having happened.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('users (integration)', () => {
  let prisma: PrismaService;
  let users: UsersService;
  const created: string[] = [];
  const firebaseDeleted: string[] = [];
  const objectsDeleted: string[] = [];

  /** Verifies a "token" of the form `uid:provider`. */
  const firebase = {
    verifyIdToken: (token: string) => {
      const [uid, provider] = token.split(':');
      if (!uid) return Promise.reject(new Error('bad token'));
      return Promise.resolve({
        uid,
        firebase: { sign_in_provider: provider ?? 'google.com' },
      });
    },
    deleteUser: (uid: string) => {
      firebaseDeleted.push(uid);
      return Promise.resolve();
    },
  } as unknown as FirebaseAdminService;

  const storage = {
    delete: (key: string) => {
      objectsDeleted.push(key);
      return Promise.resolve();
    },
  } as unknown as StorageService;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    users = new UsersService(prisma, new SeqService(prisma), firebase, storage);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    for (const userId of created) {
      await prisma.attachment.deleteMany({ where: { userId } });
      await prisma.task.deleteMany({ where: { userId } });
      await prisma.project.deleteMany({ where: { userId } });
      await prisma.organization.deleteMany({ where: { userId } });
      await prisma.syncState.deleteMany({ where: { userId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    }
    created.length = 0;
    firebaseDeleted.length = 0;
    objectsDeleted.length = 0;
  });

  const makeUser = async (opts: { anonymous?: boolean; lastSeenAt?: Date }) => {
    const user = await prisma.user.create({
      data: {
        firebaseUid: `test-${randomUUID()}`,
        anonymous: opts.anonymous ?? false,
        lastSeenAt: opts.lastSeenAt ?? new Date(),
        syncState: { create: {} },
      },
    });
    created.push(user.id);
    return user;
  };

  const principal = (u: { id: string; firebaseUid: string }) =>
    ({
      id: u.id,
      firebaseUid: u.firebaseUid,
      email: null,
      isAnonymous: false,
    }) satisfies AuthenticatedUser;

  const addTask = (userId: string, seq: bigint, deleted = false) =>
    prisma.task.create({
      data: {
        id: randomUUID(),
        userId,
        seq,
        title: `t${seq}`,
        type: 'personal',
        status: 'inbox',
        priority: 'p2',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: deleted ? new Date() : null,
      },
    });

  it('moves live guest rows to the target with sequences its devices will pull', async () => {
    const guest = await makeUser({ anonymous: true });
    const target = await makeUser({});
    // The target already has history and a device that has pulled all of it.
    await addTask(target.id, 1n);
    await addTask(target.id, 2n);
    await prisma.syncState.update({
      where: { userId: target.id },
      data: { lastSeq: 2n },
    });
    const pulledUpTo = 2n;

    await addTask(guest.id, 1n);
    await addTask(guest.id, 2n);
    await addTask(guest.id, 3n, true); // soft-deleted: nothing to carry over
    await prisma.attachment.create({
      data: {
        id: randomUUID(),
        userId: guest.id,
        seq: 4n,
        kind: 'screenshot',
        fileName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        relativePath: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        objectKey: `u/${guest.id}/a.png`,
      },
    });

    const result = await users.adoptAnonymous(
      principal(target),
      `${guest.firebaseUid}:anonymous`,
    );
    expect(result.adoptedRows).toBe(3);

    const pending = await prisma.task.findMany({
      where: { userId: target.id, seq: { gt: pulledUpTo } },
      orderBy: { seq: 'asc' },
    });
    expect(pending.map((t) => t.title)).toEqual(['t1', 't2']);
    expect(new Set(pending.map((t) => t.seq)).size).toBe(2);

    const attachments = await prisma.attachment.findMany({
      where: { userId: target.id },
    });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].seq > pulledUpTo).toBe(true);
    // The object stays where it is: the row still points at it.
    expect(objectsDeleted).toEqual([]);

    expect(
      await prisma.user.findUnique({ where: { id: guest.id } }),
    ).toBeNull();
    expect(await prisma.task.count({ where: { userId: guest.id } })).toBe(0);
    expect(firebaseDeleted).toEqual([guest.firebaseUid]);
  });

  it('refuses a token that is not a guest session', async () => {
    const other = await makeUser({});
    const target = await makeUser({});
    await addTask(other.id, 1n);

    await expect(
      users.adoptAnonymous(
        principal(target),
        `${other.firebaseUid}:google.com`,
      ),
    ).rejects.toThrow(/guest/i);
    expect(await prisma.task.count({ where: { userId: other.id } })).toBe(1);
  });

  it('refuses when the caller is itself a guest', async () => {
    const guest = await makeUser({ anonymous: true });
    await expect(
      users.adoptAnonymous(
        { ...principal(guest), isAnonymous: true },
        `x:anonymous`,
      ),
    ).rejects.toThrow(/real account/i);
  });

  it('sweeps guests unseen past the cutoff and leaves the rest', async () => {
    const day = 24 * 60 * 60 * 1000;
    const stale = await makeUser({
      anonymous: true,
      lastSeenAt: new Date(Date.now() - 40 * day),
    });
    await prisma.user.update({
      where: { id: stale.id },
      data: { createdAt: new Date(Date.now() - 41 * day) },
    });
    const recent = await makeUser({ anonymous: true });
    const real = await makeUser({
      lastSeenAt: new Date(Date.now() - 400 * day),
    });
    await prisma.user.update({
      where: { id: real.id },
      data: { createdAt: new Date(Date.now() - 401 * day) },
    });
    await addTask(stale.id, 1n);
    await prisma.attachment.create({
      data: {
        id: randomUUID(),
        userId: stale.id,
        seq: 2n,
        kind: 'screenshot',
        fileName: 'a.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        relativePath: '',
        createdAt: new Date(),
        updatedAt: new Date(),
        objectKey: `u/${stale.id}/a.png`,
      },
    });

    const result = await users.sweepAnonymous(30);
    expect(result.users).toBe(1);
    expect(result.deletedRows).toBe(2);

    expect(
      await prisma.user.findUnique({ where: { id: stale.id } }),
    ).toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: recent.id } }),
    ).not.toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: real.id } }),
    ).not.toBeNull();
    expect(firebaseDeleted).toEqual([stale.firebaseUid]);
    expect(objectsDeleted).toEqual([`u/${stale.id}/a.png`]);
  });
});
