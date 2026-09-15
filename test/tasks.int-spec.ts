import { randomUUID } from 'node:crypto';
import { RecurrenceFrequency } from '@prisma/client';
import { PrismaService } from '../src/database/prisma.service';
import { SeqService } from '../src/common/crud/seq.service';
import { RecurrenceService } from '../src/modules/recurrence/recurrence.service';
import { TasksService } from '../src/modules/tasks/tasks.service';

/**
 * The completion path, end to end.
 *
 * Completing a task is the one operation with real consequences beyond the row
 * itself — it writes history that outlives the task, and for a recurring
 * obligation it creates the next occurrence. Both are things the mobile app
 * used to do in Dart, so both are places where the server can silently disagree
 * with a client that is still doing it the old way.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb('tasks (integration)', () => {
  let prisma: PrismaService;
  let tasks: TasksService;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    prisma = new PrismaService();
    await prisma.$connect();
    const seq = new SeqService(prisma);
    tasks = new TasksService(prisma, seq, new RecurrenceService(prisma, seq));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { firebaseUid: `test-${randomUUID()}`, syncState: { create: {} } },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.checklistItem.deleteMany({ where: { userId } });
    await prisma.activityEntry.deleteMany({ where: { userId } });
    await prisma.task.deleteMany({ where: { userId } });
    await prisma.recurrenceRule.deleteMany({ where: { userId } });
    await prisma.project.deleteMany({ where: { userId } });
    await prisma.organization.deleteMany({ where: { userId } });
    await prisma.syncState.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it('mints an id when the DTO carries an explicit undefined one, as the validation pipe produces', async () => {
    // class-transformer materialises every optional DTO property, so over
    // HTTP the service sees `{ id: undefined, title: … }`, not `{ title: … }`.
    const task = await tasks.createTask(userId, {
      id: undefined,
      title: 'From the web',
    });
    expect(task.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('captures a task with nothing but a title', async () => {
    const task = await tasks.createTask(userId, { title: 'Something' });
    expect(task.status).toBe('inbox');
    expect(task.organizationId).toBeNull();
    expect(task.projectId).toBeNull();
  });

  it('stamps a sequence on every write, so mobile can pull it', async () => {
    const created = await tasks.createTask(userId, { title: 'Something' });
    expect(created.seq > 0n).toBe(true);

    const updated = await tasks.updateTask(userId, created.id, {
      title: 'Something else',
    });
    expect(updated.seq > created.seq).toBe(true);
  });

  it('refuses a parent that belongs to another account', async () => {
    const other = await prisma.user.create({
      data: { firebaseUid: `other-${randomUUID()}`, syncState: { create: {} } },
    });
    const theirProject = await prisma.project.create({
      data: {
        id: randomUUID(),
        userId: other.id,
        name: 'Theirs',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await expect(
      tasks.createTask(userId, {
        title: 'Mine',
        projectId: theirProject.id,
      }),
    ).rejects.toThrow(/Referenced project does not exist/);

    await prisma.project.deleteMany({ where: { userId: other.id } });
    await prisma.syncState.deleteMany({ where: { userId: other.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it('allows one level of subtasks and refuses two', async () => {
    const parent = await tasks.createTask(userId, { title: 'Parent' });
    const child = await tasks.createTask(userId, {
      title: 'Child',
      parentTaskId: parent.id,
    });
    expect(child.parentTaskId).toBe(parent.id);

    await expect(
      tasks.createTask(userId, {
        title: 'Grandchild',
        parentTaskId: child.id,
      }),
    ).rejects.toThrow(/one level deep/);
  });

  describe('completion', () => {
    it('writes an activity entry that records the work', async () => {
      const task = await tasks.createTask(userId, { title: 'Ship the API' });
      await tasks.complete(userId, task.id);

      const activity = await prisma.activityEntry.findMany({
        where: { userId, taskId: task.id },
      });
      expect(activity).toHaveLength(1);
      expect(activity[0].description).toBe('Ship the API');
      expect(activity[0].source).toBe('taskCompletion');
    });

    it('is idempotent — completing twice does not double the history', async () => {
      const task = await tasks.createTask(userId, { title: 'Ship the API' });
      await tasks.complete(userId, task.id);
      const second = await tasks.complete(userId, task.id);

      expect(second.next).toBeNull();
      expect(
        await prisma.activityEntry.count({
          where: { userId, taskId: task.id },
        }),
      ).toBe(1);
    });

    it('keeps the activity entry when the task is deleted', async () => {
      const task = await tasks.createTask(userId, { title: 'Ship the API' });
      await tasks.complete(userId, task.id);
      await tasks.removeTask(userId, task.id);

      const activity = await prisma.activityEntry.findMany({
        where: { userId },
      });
      expect(activity).toHaveLength(1);
      expect(activity[0].deletedAt).toBeNull();
      // Decoupled, not cascaded: the record of the work survives the task.
      expect(activity[0].taskId).toBeNull();
      expect(activity[0].description).toBe('Ship the API');
    });

    it('tombstones the checklist along with the task', async () => {
      const task = await tasks.createTask(userId, { title: 'Ship the API' });
      await tasks.addChecklistItem(userId, task.id, {
        label: 'Write the tests',
      });
      await tasks.removeTask(userId, task.id);

      const items = await prisma.checklistItem.findMany({ where: { userId } });
      expect(items).toHaveLength(1);
      expect(items[0].deletedAt).not.toBeNull();
    });
  });

  describe('recurrence', () => {
    const monthlyOn = (dayOfMonth: number) => ({
      frequency: RecurrenceFrequency.monthly,
      dayOfMonth,
    });

    it('creates the next occurrence as a new row sharing the series', async () => {
      const first = await tasks.createTask(userId, {
        title: 'File VAT return',
        deadline: new Date(2026, 8, 15, 9, 0).toISOString(),
        recurrence: monthlyOn(15),
      });
      expect(first.recurringSeriesId).not.toBeNull();

      const { task: completed, next } = await tasks.complete(userId, first.id);

      expect(completed.status).toBe('done');
      expect(next).not.toBeNull();
      expect(next!.id).not.toBe(first.id);
      expect(next!.recurringSeriesId).toBe(first.recurringSeriesId);
      expect(next!.status).toBe('next');
      expect(next!.deadline!.getMonth()).toBe(9); // October
      expect(next!.deadline!.getDate()).toBe(15);
    });

    it('records the completion as recurring work, not a one-off', async () => {
      const first = await tasks.createTask(userId, {
        title: 'File VAT return',
        deadline: new Date(2026, 8, 15).toISOString(),
        recurrence: monthlyOn(15),
      });
      await tasks.complete(userId, first.id);

      const activity = await prisma.activityEntry.findFirst({
        where: { userId, taskId: first.id },
      });
      expect(activity?.source).toBe('recurringTask');
    });

    it('anchors the next occurrence to the deadline, not the completion date', async () => {
      const first = await tasks.createTask(userId, {
        title: 'File VAT return',
        deadline: new Date(2026, 8, 15, 9, 0).toISOString(),
        recurrence: monthlyOn(15),
      });

      // Filed three days late.
      const { next } = await tasks.complete(
        userId,
        first.id,
        new Date(2026, 8, 18, 14, 0),
      );

      // Still due on the 15th of next month — being late once must not shift
      // every future return.
      expect(next!.deadline!.getDate()).toBe(15);
      expect(next!.deadline!.getMonth()).toBe(9);
    });

    it('carries the checklist forward unticked', async () => {
      const first = await tasks.createTask(userId, {
        title: 'File VAT return',
        deadline: new Date(2026, 8, 15).toISOString(),
        recurrence: monthlyOn(15),
      });
      const item = await tasks.addChecklistItem(userId, first.id, {
        label: 'Download the bank statement',
      });
      await tasks.updateChecklistItem(userId, item.id, { done: true });

      const { next } = await tasks.complete(userId, first.id);
      const carried = await tasks.checklist(userId, next!.id);

      expect(carried).toHaveLength(1);
      expect(carried[0].label).toBe('Download the bank statement');
      expect(carried[0].done).toBe(false);
    });

    it('does not fork the series when the same occurrence is completed twice', async () => {
      const first = await tasks.createTask(userId, {
        title: 'File VAT return',
        deadline: new Date(2026, 8, 15).toISOString(),
        recurrence: monthlyOn(15),
      });
      await tasks.complete(userId, first.id);

      // Reopen and complete again — an undo, or a replayed sync push.
      await tasks.reopen(userId, first.id);
      await tasks.complete(userId, first.id);

      const series = await tasks.seriesHistory(
        userId,
        first.recurringSeriesId!,
      );
      expect(series).toHaveLength(2);
    });

    it('stops the series once the end date has passed', async () => {
      const first = await tasks.createTask(userId, {
        title: 'Weekly report',
        deadline: new Date(2026, 8, 15).toISOString(),
        recurrence: {
          frequency: RecurrenceFrequency.weekly,
          endDate: new Date(2026, 8, 20).toISOString(),
        },
      });

      const { next } = await tasks.complete(userId, first.id);
      // The next occurrence would fall on the 22nd, past the end date.
      expect(next).toBeNull();
    });

    it('leaves a non-recurring task alone', async () => {
      const task = await tasks.createTask(userId, { title: 'One-off' });
      const { next } = await tasks.complete(userId, task.id);
      expect(next).toBeNull();
    });
  });

  describe('deadline precision', () => {
    it('keeps a week deadline soft, and resets to day when the date is cleared', async () => {
      const task = await tasks.createTask(userId, {
        title: 'Sometime this week',
        deadline: '2026-09-20T00:00:00.000Z',
        deadlinePrecision: 'week',
      });
      expect(task.deadlinePrecision).toBe('week');

      const cleared = await tasks.updateTask(userId, task.id, {
        deadline: null as unknown as string,
      });
      expect(cleared.deadline).toBeNull();
      expect(cleared.deadlinePrecision).toBe('day');
    });

    it('ignores a precision sent without a date', async () => {
      const task = await tasks.createTask(userId, {
        title: 'Undated',
        deadlinePrecision: 'week',
      });
      expect(task.deadlinePrecision).toBe('day');
    });
  });

  describe('carry forward', () => {
    it('counts how many times a task has been deferred', async () => {
      const task = await tasks.createTask(userId, { title: 'Keeps slipping' });
      await tasks.carryForward(userId, task.id);
      const twice = await tasks.carryForward(userId, task.id);

      expect(twice.carryForwardCount).toBe(2);
      expect(twice.carriedForwardAt).not.toBeNull();
    });
  });
});
