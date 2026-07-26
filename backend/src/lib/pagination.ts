const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface Pagination {
  page: number;
  limit: number;
  offset: number;
}

function parseIntOr(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePagination(query: Record<string, unknown>): Pagination {
  const page = Math.max(1, parseIntOr(query.page, 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseIntOr(query.limit, DEFAULT_LIMIT)));
  return { page, limit, offset: (page - 1) * limit };
}

export function paginated<T>(data: T[], pagination: Pagination, total: number) {
  return {
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / pagination.limit)),
    },
  };
}
