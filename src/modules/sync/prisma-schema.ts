import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A minimal reader for `prisma/schema.prisma`.
 *
 * Prisma 7 trims the runtime datamodel down to names, kinds and `@map`ped
 * column names — `isRequired`, `hasDefaultValue` and the enum value lists are
 * all gone, and the sync layer needs every one of them to validate a client
 * row. The schema file is the only remaining source, and it is deployed
 * alongside the build because `prisma migrate deploy` needs it too.
 *
 * This parser is deliberately small. It understands the subset of the Prisma
 * schema language this project actually uses; anything more exotic would be a
 * reason to reconsider, not a reason to grow the parser.
 */
export interface PrismaField {
  name: string;
  /** Column name — the `@map` value, or the field name. */
  dbName: string;
  type: string;
  kind: 'scalar' | 'enum' | 'object';
  isRequired: boolean;
  isList: boolean;
  hasDefault: boolean;
}

export interface PrismaModel {
  name: string;
  /** Table name — the `@@map` value, or the model name. */
  dbName: string;
  fields: PrismaField[];
}

export interface PrismaSchema {
  models: Map<string, PrismaModel>;
  enums: Map<string, string[]>;
}

/** Where the schema lives, relative to both `src/` and `dist/`. */
export function defaultSchemaPath(): string {
  const fromEnv = process.env.PRISMA_SCHEMA_PATH;
  if (fromEnv) return fromEnv;
  return join(__dirname, '../../../prisma/schema.prisma');
}

export function loadPrismaSchema(path = defaultSchemaPath()): PrismaSchema {
  if (!existsSync(path)) {
    throw new Error(
      `Cannot read the Prisma schema at ${path}. The sync layer derives its ` +
        'wire contract from it, so the file must ship with the build. Set ' +
        'PRISMA_SCHEMA_PATH if it lives elsewhere.',
    );
  }
  return parsePrismaSchema(readFileSync(path, 'utf8'));
}

export function parsePrismaSchema(source: string): PrismaSchema {
  const enums = new Map<string, string[]>();
  const models = new Map<string, PrismaModel>();

  for (const [, name, body] of source.matchAll(
    /^enum\s+(\w+)\s*\{([^}]*)\}/gms,
  )) {
    enums.set(
      name,
      blockLines(body).filter((line) => /^\w+$/.test(line)),
    );
  }

  const modelBodies = new Map<string, string>();
  for (const [, name, body] of source.matchAll(
    /^model\s+(\w+)\s*\{([^}]*)\}/gms,
  )) {
    modelBodies.set(name, body);
  }

  for (const [name, body] of modelBodies) {
    const lines = blockLines(body);
    let dbName = name;
    const fields: PrismaField[] = [];

    for (const line of lines) {
      if (line.startsWith('@@')) {
        const mapped = /@@map\("([^"]+)"\)/.exec(line);
        if (mapped) dbName = mapped[1];
        continue;
      }

      // `fieldName  Type?  @map("column") @default(now())`
      const match = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(line);
      if (!match) continue;

      const [, fieldName, type, list, optional, attributes] = match;
      const isList = list === '[]';
      const isRelation =
        modelBodies.has(type) && (isList || attributes.includes('@relation'));

      const mapped = /@map\("([^"]+)"\)/.exec(attributes);

      fields.push({
        name: fieldName,
        dbName: mapped ? mapped[1] : fieldName,
        type,
        kind: isRelation
          ? 'object'
          : enums.has(type)
            ? 'enum'
            : modelBodies.has(type)
              ? 'object'
              : 'scalar',
        isRequired: !optional && !isList,
        isList,
        hasDefault:
          attributes.includes('@default(') || attributes.includes('@updatedAt'),
      });
    }

    models.set(name, { name, dbName, fields });
  }

  return { models, enums };
}

/** Non-empty, non-comment lines of a block body. */
function blockLines(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));
}
