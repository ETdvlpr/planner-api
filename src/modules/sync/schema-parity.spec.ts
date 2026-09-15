import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SYNC_TABLES } from './sync-registry';
import { loadPrismaSchema } from './prisma-schema';

/**
 * Guards the seam between the two schemas.
 *
 * The Prisma models mirror the Drift tables by hand, and the plan is explicit
 * that keeping them in step is a permanent tax. This test is how that tax gets
 * paid automatically: it parses the Dart table definitions and compares them,
 * column by column, with the generated Prisma datamodel.
 *
 * It skips itself when the mobile repo is not checked out alongside, so CI for
 * the API alone still passes.
 */
const DRIFT_TABLES = join(
  __dirname,
  '../../../../planner-mobile/lib/core/database/tables.dart',
);

/**
 * Columns the server has and the client does not, with the reason. Anything
 * outside this set that appears only on the server is a mistake.
 */
const SERVER_ONLY_COLUMNS: Record<string, string> = {
  user_id: 'multi-tenancy — denormalised onto every row',
  deleted_at: 'soft deletes — the client hard-deletes and queues a delete op',
  seq: 'per-user sync sequence',
};

/**
 * Columns the **client** is still missing, and which the next Drift schema
 * version must add. Every entry here is a row that cannot take part in
 * last-writer-wins conflict resolution until it exists on the device.
 *
 * Empty since Drift `schemaVersion` 2 (2026-09-13): every replicated table
 * carries `updated_at`, and the media tables mirror `object_key` /
 * `uploaded_at` so a device can tell whether the bytes are in R2.
 */
const PENDING_CLIENT_MIGRATION: Record<string, string[]> = {};

interface DriftTable {
  className: string;
  columns: string[];
}

/** Drift's default: camelCase field name → snake_case column. */
function snake(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function parseDriftTables(source: string): Map<string, DriftTable> {
  const tables = new Map<string, DriftTable>();
  // `class Tasks extends Table with _Identified {` … up to the closing brace of
  // the class, which is the first line that is exactly `}`.
  const classRe =
    /class\s+(\w+)\s+extends\s+Table(\s+with\s+([\w,\s]+))?\s*\{/g;

  let match: RegExpExecArray | null;
  while ((match = classRe.exec(source)) !== null) {
    const className = match[1];
    const mixins = match[3] ?? '';
    const bodyStart = classRe.lastIndex;
    const bodyEnd = source.indexOf('\n}', bodyStart);
    const body = source.slice(bodyStart, bodyEnd);

    const columns: string[] = [];
    if (mixins.includes('_Identified')) {
      columns.push('id', 'created_at', 'updated_at');
    }

    // `TextColumn get relativePath => text()();`  — the accessor name is the
    // column, unless `.named('…')` overrides it.
    const fieldRe = /\b\w+Column\s+get\s+(\w+)\s*=>([^;]*);/g;
    let field: RegExpExecArray | null;
    while ((field = fieldRe.exec(body)) !== null) {
      const named = /\.named\('([^']+)'\)/.exec(field[2]);
      columns.push(named ? named[1] : snake(field[1]));
    }

    tables.set(className, { className, columns });
  }

  return tables;
}

/** Drift class name → wire table name, matching the sync registry. */
const CLASS_TO_TABLE: Record<string, string> = {
  Organizations: 'organizations',
  Projects: 'projects',
  RecurrenceRules: 'recurrence_rules',
  Tasks: 'tasks',
  ChecklistItems: 'checklist_items',
  Meetings: 'meetings',
  MeetingNoteItems: 'meeting_note_items',
  Requirements: 'requirements',
  Notes: 'notes',
  Decisions: 'decisions',
  ActivityEntries: 'activity_entries',
  Attachments: 'attachments',
  VoiceNotes: 'voice_notes',
};

const describeOrSkip = existsSync(DRIFT_TABLES) ? describe : describe.skip;

describeOrSkip('Prisma ↔ Drift schema parity', () => {
  const drift = parseDriftTables(readFileSync(DRIFT_TABLES, 'utf8'));

  const schema = loadPrismaSchema();

  const prismaColumns = (model: string): string[] => {
    const definition = schema.models.get(model);
    if (!definition) throw new Error(`No Prisma model named ${model}`);
    return definition.fields
      .filter((f) => f.kind !== 'object' && !f.isList)
      .map((f) => f.dbName);
  };

  it('covers every syncable Drift table', () => {
    for (const table of SYNC_TABLES) {
      const className = Object.entries(CLASS_TO_TABLE).find(
        ([, wire]) => wire === table.name,
      )?.[0];
      expect(className).toBeDefined();
      expect(drift.has(className!)).toBe(true);
    }
  });

  for (const [className, wireName] of Object.entries(CLASS_TO_TABLE)) {
    describe(wireName, () => {
      it('has every client column on the server', () => {
        const clientColumns = drift.get(className)!.columns;
        const serverColumns = new Set(
          prismaColumns(SYNC_TABLES.find((t) => t.name === wireName)!.model),
        );

        const missing = clientColumns.filter((c) => !serverColumns.has(c));
        expect(missing).toEqual([]);
      });

      it('adds only documented server-only columns', () => {
        const clientColumns = new Set(drift.get(className)!.columns);
        const pending = PENDING_CLIENT_MIGRATION[wireName] ?? [];
        for (const column of pending) clientColumns.add(column);

        const serverColumns = prismaColumns(
          SYNC_TABLES.find((t) => t.name === wireName)!.model,
        );

        const undocumented = serverColumns.filter(
          (c) => !clientColumns.has(c) && !(c in SERVER_ONLY_COLUMNS),
        );
        expect(undocumented).toEqual([]);
      });
    });
  }
});
