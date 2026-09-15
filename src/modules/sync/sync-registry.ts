import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { loadPrismaSchema } from './prisma-schema';

/**
 * A syncable table, as the wire sees it.
 *
 * `name` is the client's table name — the Drift table, snake_cased — and is the
 * contract with the mobile app. `model` is the Prisma model behind it.
 */
export interface SyncTableDef {
  /** Wire name, e.g. `checklist_items`. */
  name: string;
  /** Prisma model name, e.g. `ChecklistItem`. */
  model: string;
  /** Prisma delegate key on the client, e.g. `checklistItem`. */
  delegate: string;
  /**
   * Apply order within a push batch. Lower goes first, so a project lands
   * before the task that points at it. This matters because there are no
   * database-level foreign keys (see prisma/schema.prisma) — ordering is what
   * keeps a batch internally consistent for anything that reads it mid-flight.
   */
  order: number;
}

/**
 * Columns the client may never set. `userId` and `seq` are the two that make
 * the whole model safe: ownership comes from the verified token, and the
 * sequence is the server's alone. `deletedAt` is excluded because deletion is
 * an operation (`op: 'delete'`), not a field the client writes.
 *
 * `objectKey` / `uploadedAt` are assigned when the upload URL is issued; a
 * client that could set them could point an attachment row at someone else's
 * object.
 */
const SERVER_OWNED_FIELDS = new Set([
  'userId',
  'seq',
  'deletedAt',
  'objectKey',
  'uploadedAt',
]);

/**
 * Fields carried by the change envelope rather than by `data`. A client that
 * serialises a whole row will include them; they are dropped rather than
 * rejected, because the envelope's copy is the one the conflict rule compares
 * and a second copy inside `data` could disagree with it.
 */
const ENVELOPE_FIELDS = new Set(['id', 'updatedAt']);

/**
 * The 13 tables that replicate.
 *
 * Two client tables are deliberately absent:
 *
 * - `reminders` — device-local. Its `notificationId` is a 32-bit handle owned by
 *   the OS notification scheduler on one device; replicating it would collide
 *   across installs. The mobile app already rebuilds the schedule from tasks.
 * - `app_settings` — device-local for now. It is a key/value table with no id
 *   or timestamps, so it does not fit the uniform row contract below. Syncing
 *   preferences is a phase-4 follow-up, not a blocker.
 */
export const SYNC_TABLES: readonly SyncTableDef[] = [
  {
    name: 'organizations',
    model: 'Organization',
    delegate: 'organization',
    order: 10,
  },
  { name: 'projects', model: 'Project', delegate: 'project', order: 20 },
  {
    name: 'recurrence_rules',
    model: 'RecurrenceRule',
    delegate: 'recurrenceRule',
    order: 30,
  },
  { name: 'meetings', model: 'Meeting', delegate: 'meeting', order: 40 },
  {
    name: 'requirements',
    model: 'Requirement',
    delegate: 'requirement',
    order: 50,
  },
  { name: 'tasks', model: 'Task', delegate: 'task', order: 60 },
  {
    name: 'checklist_items',
    model: 'ChecklistItem',
    delegate: 'checklistItem',
    order: 70,
  },
  {
    name: 'meeting_note_items',
    model: 'MeetingNoteItem',
    delegate: 'meetingNoteItem',
    order: 80,
  },
  { name: 'notes', model: 'Note', delegate: 'note', order: 90 },
  { name: 'decisions', model: 'Decision', delegate: 'decision', order: 100 },
  {
    name: 'activity_entries',
    model: 'ActivityEntry',
    delegate: 'activityEntry',
    order: 110,
  },
  {
    name: 'attachments',
    model: 'Attachment',
    delegate: 'attachment',
    order: 120,
  },
  {
    name: 'voice_notes',
    model: 'VoiceNote',
    delegate: 'voiceNote',
    order: 130,
  },
];

interface FieldMeta {
  name: string;
  type: string;
  kind: 'scalar' | 'enum';
  isRequired: boolean;
  hasDefault: boolean;
  enumValues?: readonly string[];
}

export interface TableSchema extends SyncTableDef {
  /** Every field the client may send, by name. */
  writable: Map<string, FieldMeta>;
  /** Writable fields that must be present when a row is created. */
  requiredOnCreate: readonly string[];
}

/**
 * Turns the Prisma schema into the sync wire contract.
 *
 * Deriving the column list from the schema rather than hand-listing it is what
 * keeps this layer generic: adding a column to `schema.prisma` makes it
 * syncable, with no second list to forget. It is also the reason the server can
 * stay ignorant of what a Meeting *means* while still validating what a Meeting
 * row may contain.
 */
@Injectable()
export class SyncRegistry {
  private readonly logger = new Logger(SyncRegistry.name);
  private readonly byName = new Map<string, TableSchema>();

  // No constructor parameters. An optional `schemaPath?: string` here compiles
  // to `design:paramtypes = [String]`, which Nest then tries to resolve as a
  // provider and fails on at boot. Override the location with the
  // PRISMA_SCHEMA_PATH environment variable instead.
  constructor() {
    const schema = loadPrismaSchema();

    for (const def of SYNC_TABLES) {
      const model = schema.models.get(def.model);
      if (!model) {
        throw new Error(`Sync registry references unknown model ${def.model}`);
      }

      const writable = new Map<string, FieldMeta>();
      const requiredOnCreate: string[] = [];

      for (const field of model.fields) {
        if (field.kind === 'object' || field.isList) continue;
        if (SERVER_OWNED_FIELDS.has(field.name)) continue;
        if (ENVELOPE_FIELDS.has(field.name)) continue;

        const meta: FieldMeta = {
          name: field.name,
          type: field.type,
          kind: field.kind === 'enum' ? 'enum' : 'scalar',
          isRequired: field.isRequired,
          hasDefault: field.hasDefault,
          enumValues:
            field.kind === 'enum' ? schema.enums.get(field.type) : undefined,
        };
        writable.set(field.name, meta);

        if (field.isRequired && !field.hasDefault) {
          requiredOnCreate.push(field.name);
        }
      }

      this.byName.set(def.name, { ...def, writable, requiredOnCreate });
    }

    this.logger.log(`Sync registry ready: ${this.byName.size} tables`);
  }

  /** Every table, in the order a push batch must apply them. */
  get tables(): TableSchema[] {
    return [...this.byName.values()].sort((a, b) => a.order - b.order);
  }

  get(name: string): TableSchema {
    const table = this.byName.get(name);
    if (!table) throw new BadRequestException(`Unknown sync table: ${name}`);
    return table;
  }

  /**
   * Validates and coerces one client row into Prisma input.
   *
   * JSON has no Date and no distinction between int and float, so every
   * timestamp arrives as an ISO string and every number as a `number`. Anything
   * the schema does not know about is rejected rather than ignored: a client
   * sending a field this server drops silently would believe it had synced.
   */
  coerce(
    table: TableSchema,
    input: Record<string, unknown>,
    { forCreate }: { forCreate: boolean },
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      // Dropped, never trusted: ownership and sequencing are the server's,
      // and id/updatedAt belong to the envelope.
      if (SERVER_OWNED_FIELDS.has(key) || ENVELOPE_FIELDS.has(key)) continue;
      const meta = table.writable.get(key);
      if (!meta) {
        throw new BadRequestException(
          `Unknown field '${key}' for table '${table.name}'`,
        );
      }
      out[key] = coerceValue(table.name, meta, value);
    }

    if (forCreate) {
      const missing = table.requiredOnCreate.filter(
        (f) => out[f] === undefined,
      );
      if (missing.length > 0) {
        throw new BadRequestException(
          `Missing required field(s) for '${table.name}': ${missing.join(', ')}`,
        );
      }
    }

    return out;
  }
}

function coerceValue(
  tableName: string,
  meta: FieldMeta,
  value: unknown,
): unknown {
  if (value === null || value === undefined) {
    if (meta.isRequired) {
      throw new BadRequestException(
        `Field '${meta.name}' on '${tableName}' may not be null`,
      );
    }
    return null;
  }

  const fail = (expected: string): never => {
    throw new BadRequestException(
      `Field '${meta.name}' on '${tableName}' must be ${expected}`,
    );
  };

  if (meta.kind === 'enum') {
    if (typeof value !== 'string' || !meta.enumValues?.includes(value)) {
      return fail(`one of: ${meta.enumValues?.join(', ') ?? ''}`);
    }
    return value;
  }

  switch (meta.type) {
    case 'String':
      return typeof value === 'string' ? value : fail('a string');
    case 'Boolean':
      return typeof value === 'boolean' ? value : fail('a boolean');
    case 'Int': {
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return fail('an integer');
      }
      return value;
    }
    case 'Float':
      return typeof value === 'number' ? value : fail('a number');
    case 'DateTime': {
      const date =
        value instanceof Date
          ? value
          : typeof value === 'string' || typeof value === 'number'
            ? new Date(value)
            : null;
      if (!date || Number.isNaN(date.getTime())) {
        return fail('an ISO-8601 timestamp');
      }
      return date;
    }
    default:
      return fail(`of type ${meta.type}`);
  }
}
