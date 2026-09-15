import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { SeqService } from './seq.service';
import { paginated, pageSkip, type Paginated } from '../pagination';

/** Models that can be referenced as a parent, for {@link ScopedCrudService.assertOwnedOrNull}. */
export type OwnedModel =
  | 'organization'
  | 'project'
  | 'meeting'
  | 'task'
  | 'requirement'
  | 'note'
  | 'recurrenceRule'
  | 'meetingNoteItem';

/** One Prisma `orderBy` clause. */
export type OrderBy = Record<string, 'asc' | 'desc' | undefined>;

/** The delegate surface the base class needs. Every domain model has it. */
export interface CrudDelegate<T> {
  findMany(args: unknown): Promise<T[]>;
  findFirst(args: unknown): Promise<T | null>;
  count(args: unknown): Promise<number>;
  create(args: unknown): Promise<T>;
  update(args: unknown): Promise<T>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

export interface ListOptions {
  page?: number;
  pageSize?: number;
  includeDeleted?: boolean;
}

/**
 * Shared behaviour for every owned resource: ownership scoping, soft deletes,
 * and sequence stamping.
 *
 * Three invariants live here rather than in thirteen services, because each is
 * the kind of rule that is only ever wrong once:
 *
 * 1. `userId` comes from the caller's verified token and is written into every
 *    `where` clause. There is no code path that reads a row by id alone.
 * 2. Nothing is hard-deleted. `remove()` sets `deletedAt`.
 * 3. Every mutation allocates a `seq`, so mobile can pull it.
 */
@Injectable()
export abstract class ScopedCrudService<T extends { id: string }> {
  /** Prisma delegate key, e.g. `organization`. */
  protected abstract readonly model: string;
  /** Default ordering for `list()`. Prisma `orderBy` clauses, in order. */
  protected defaultOrderBy: OrderBy[] = [{ updatedAt: 'desc' }];

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly seq: SeqService,
  ) {}

  protected delegate(client: unknown = this.prisma): CrudDelegate<T> {
    return (client as Record<string, CrudDelegate<T>>)[this.model];
  }

  /** Ownership + soft-delete filter, merged with any caller filter. */
  protected scope(
    userId: string,
    where: Record<string, unknown> = {},
    includeDeleted = false,
  ): Record<string, unknown> {
    return {
      ...where,
      userId,
      ...(includeDeleted ? {} : { deletedAt: null }),
    };
  }

  async list(
    userId: string,
    options: ListOptions = {},
    where: Record<string, unknown> = {},
    orderBy?: OrderBy[],
  ): Promise<Paginated<T>> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 25;
    const filter = this.scope(userId, where, options.includeDeleted);

    const [items, total] = await Promise.all([
      this.delegate().findMany({
        where: filter,
        orderBy: orderBy ?? this.defaultOrderBy,
        skip: pageSkip(page, pageSize),
        take: pageSize,
      }),
      this.delegate().count({ where: filter }),
    ]);

    return paginated(items, total, page, pageSize);
  }

  async findOne(
    userId: string,
    id: string,
    includeDeleted = false,
  ): Promise<T> {
    const row = await this.delegate().findFirst({
      where: this.scope(userId, { id }, includeDeleted),
    });
    if (!row) throw new NotFoundException(`${this.model} not found`);
    return row;
  }

  async create(userId: string, data: Record<string, unknown>): Promise<T> {
    const now = new Date();
    const seq = await this.seq.next(userId);
    return this.delegate().create({
      data: {
        ...data,
        // Ids are client-generatable by design — the mobile app creates rows
        // offline and pushes them later, so the server must accept an id it
        // did not mint. It just never accepts an owner. Assigned *after* the
        // spread: a validated DTO carries every optional field as an explicit
        // `undefined`, and `id: undefined` would otherwise win.
        id: (data.id as string | undefined) ?? randomUUID(),
        userId,
        createdAt: now,
        updatedAt: now,
        seq,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    data: Record<string, unknown>,
  ): Promise<T> {
    await this.findOne(userId, id);
    const seq = await this.seq.next(userId);
    return this.delegate().update({
      where: { id },
      data: { ...data, updatedAt: new Date(), seq },
    });
  }

  /** Soft delete. The row stays so peers can learn it is gone. */
  async remove(userId: string, id: string): Promise<T> {
    await this.findOne(userId, id);
    const seq = await this.seq.next(userId);
    return this.delegate().update({
      where: { id },
      data: { deletedAt: new Date(), updatedAt: new Date(), seq },
    });
  }

  /**
   * Guards the one thing a denormalised `user_id` cannot: a caller pointing
   * their row at a parent that belongs to someone else.
   *
   * Parent ids arrive from the client — they must, because the mobile app
   * creates whole object graphs offline — so each one is checked against the
   * caller's own rows before it is stored. Null and undefined pass: the
   * hierarchy is optional at every level.
   */
  protected async assertOwnedOrNull(
    userId: string,
    model: OwnedModel,
    id: string | null | undefined,
  ): Promise<void> {
    if (!id) return;
    const delegate = (
      this.prisma as unknown as Record<
        string,
        { findFirst(args: unknown): Promise<{ id: string } | null> }
      >
    )[model];
    const found = await delegate.findFirst({
      where: { id, userId, deletedAt: null },
      select: { id: true },
    });
    if (!found) {
      throw new BadRequestException(`Referenced ${model} does not exist`);
    }
  }

  /** Undo a soft delete. */
  async restore(userId: string, id: string): Promise<T> {
    await this.findOne(userId, id, true);
    const seq = await this.seq.next(userId);
    return this.delegate().update({
      where: { id },
      data: { deletedAt: null, updatedAt: new Date(), seq },
    });
  }
}
