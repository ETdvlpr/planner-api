/** Standard envelope for an offset-paginated list response. */
export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export function pageSkip(page: number, pageSize: number): number {
  return (page - 1) * pageSize;
}
