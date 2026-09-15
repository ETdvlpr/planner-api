import { BadRequestException } from '@nestjs/common';
import { SyncRegistry, SYNC_TABLES } from './sync-registry';

describe('SyncRegistry', () => {
  const registry = new SyncRegistry();
  const tasks = registry.get('tasks');

  it('exposes every declared table', () => {
    expect(registry.tables).toHaveLength(SYNC_TABLES.length);
  });

  it('orders parents before children', () => {
    const order = registry.tables.map((t) => t.name);
    expect(order.indexOf('projects')).toBeLessThan(order.indexOf('tasks'));
    expect(order.indexOf('tasks')).toBeLessThan(
      order.indexOf('checklist_items'),
    );
    expect(order.indexOf('meetings')).toBeLessThan(
      order.indexOf('meeting_note_items'),
    );
  });

  it('rejects an unknown table', () => {
    expect(() => registry.get('nope')).toThrow(BadRequestException);
  });

  describe('server-owned fields', () => {
    it('never lets a client set the owner', () => {
      const coerced = registry.coerce(
        tasks,
        {
          title: 'x',
          type: 'admin',
          status: 'inbox',
          priority: 'p2',
          createdAt: '2026-09-10T08:00:00.000Z',
          userId: 'someone-else',
        },
        { forCreate: true },
      );
      expect(coerced).not.toHaveProperty('userId');
    });

    it('drops an `id` inside data rather than rejecting the row', () => {
      const coerced = registry.coerce(
        tasks,
        { id: '2f1c2d2e-6f0f-4c0d-9e1a-6f1a2b3c4d5e' },
        { forCreate: false },
      );
      expect(coerced).not.toHaveProperty('id');
    });

    it('ignores an `updatedAt` inside data — the envelope owns it', () => {
      const coerced = registry.coerce(
        tasks,
        { updatedAt: '2030-01-01T00:00:00.000Z' },
        { forCreate: false },
      );
      expect(coerced).not.toHaveProperty('updatedAt');
    });

    it('never lets a client set the sequence', () => {
      const coerced = registry.coerce(tasks, { seq: 99 }, { forCreate: false });
      expect(coerced).not.toHaveProperty('seq');
    });

    it('never lets a client point a row at an arbitrary R2 object', () => {
      const attachments = registry.get('attachments');
      const coerced = registry.coerce(
        attachments,
        { objectKey: 'u/another-user/secret.png' },
        { forCreate: false },
      );
      expect(coerced).not.toHaveProperty('objectKey');
    });
  });

  describe('coercion', () => {
    it('parses timestamps into Dates', () => {
      const coerced = registry.coerce(
        tasks,
        { deadline: '2026-09-10T08:00:00.000Z' },
        { forCreate: false },
      );
      expect(coerced.deadline).toBeInstanceOf(Date);
    });

    it('accepts a valid enum value', () => {
      const coerced = registry.coerce(
        tasks,
        { status: 'inProgress' },
        { forCreate: false },
      );
      expect(coerced.status).toBe('inProgress');
    });

    it('rejects an enum value the client invented', () => {
      expect(() =>
        registry.coerce(tasks, { status: 'in_progress' }, { forCreate: false }),
      ).toThrow(BadRequestException);
    });

    it('rejects a field the schema does not have', () => {
      expect(() =>
        registry.coerce(tasks, { nonsense: 1 }, { forCreate: false }),
      ).toThrow(BadRequestException);
    });

    it('rejects a non-integer where an integer is required', () => {
      expect(() =>
        registry.coerce(tasks, { sortOrder: 1.5 }, { forCreate: false }),
      ).toThrow(BadRequestException);
    });

    it('rejects an unparseable timestamp', () => {
      expect(() =>
        registry.coerce(tasks, { deadline: 'yesterday' }, { forCreate: false }),
      ).toThrow(BadRequestException);
    });

    it('rejects null for a required column', () => {
      expect(() =>
        registry.coerce(tasks, { title: null }, { forCreate: false }),
      ).toThrow(BadRequestException);
    });

    it('allows null for an optional column', () => {
      const coerced = registry.coerce(
        tasks,
        { deadline: null },
        { forCreate: false },
      );
      expect(coerced.deadline).toBeNull();
    });
  });

  describe('creates', () => {
    it('demands the columns with no default', () => {
      expect(() =>
        registry.coerce(tasks, { title: 'Only a title' }, { forCreate: true }),
      ).toThrow(/Missing required field/);
    });

    it('accepts a complete row', () => {
      const coerced = registry.coerce(
        tasks,
        {
          title: 'File Q3 VAT return',
          type: 'admin',
          status: 'next',
          priority: 'p1',
          createdAt: '2026-09-10T08:00:00.000Z',
        },
        { forCreate: true },
      );
      expect(coerced.title).toBe('File Q3 VAT return');
      expect(coerced.createdAt).toBeInstanceOf(Date);
    });

    it('does not require a column that has a default', () => {
      const coerced = registry.coerce(
        registry.get('checklist_items'),
        {
          taskId: '2f1c2d2e-6f0f-4c0d-9e1a-6f1a2b3c4d5e',
          label: 'Download the statement',
          createdAt: '2026-09-10T08:00:00.000Z',
        },
        { forCreate: true },
      );
      expect(coerced).not.toHaveProperty('done'); // defaulted by the schema
    });
  });
});
