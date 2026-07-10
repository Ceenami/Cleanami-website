
import { SQL, and, or, ilike, desc, eq, sql, gte, lte } from 'drizzle-orm';

export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface SearchParams {
  query?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  nextPage: number | null;
  page: number;
  limit: number;
  total?: number;
}

export function getPaginationOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

export function getNextPage(currentPage: number, dataLength: number, limit: number): number | null {
  return dataLength === limit ? currentPage + 1 : null;
}

export function buildSearchCondition(query: string | undefined, fields: any[]): SQL | undefined {
  if (!query || query.trim() === '') return undefined;
  
  const searchPattern = `%${query.trim()}%`;
  const conditions = fields.map(field => ilike(field, searchPattern));
  
  return or(...conditions);
}

export function buildPaginatedResponse<T>(
  data: T[],
  page: number,
  limit: number,
  total?: number
): PaginatedResponse<T> {
  return {
    data,
    nextPage: getNextPage(page, data.length, limit),
    page,
    limit,
    total,
  };
}

export const aggregations = {
  count: (field: any) => sql<number>`cast(count(${field}) as integer)`,
  countDistinct: (field: any) => sql<number>`cast(count(distinct ${field}) as integer)`,
  countWhere: (field: any, condition: SQL) => 
    sql<number>`cast(count(case when ${condition} then 1 end) as integer)`,
  sum: (field: any) => sql<string>`cast(coalesce(sum(${field}), 0) as text)`,
  avg: (field: any) => sql<string>`cast(avg(${field}) as text)`,
};

export const filters = {

  byStatus: <T extends string>(statusField: any, status: T | 'all') => {
    return status === 'all' ? undefined : eq(statusField, status);
  },
  
  byDateRange: (dateField: any, start?: Date, end?: Date) => {
    const conditions: SQL[] = [];
    if (start) conditions.push(gte(dateField, start));
    if (end) conditions.push(lte(dateField, end));
    return conditions.length > 0 ? and(...conditions) : undefined;
  },
  
  byBoolean: (field: any, value: boolean | undefined) => {
    return value !== undefined ? eq(field, value) : undefined;
  },
};

export const ordering = {
  createdAtDesc: (table: any) => desc(table.createdAt),
  updatedAtDesc: (table: any) => desc(table.updatedAt),
};