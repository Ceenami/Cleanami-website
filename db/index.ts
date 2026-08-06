import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

config({ path: ".env.local" });

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let client: ReturnType<typeof postgres> | null = null;
let database: DrizzleDb | null = null;

function isDatabaseUrlConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  if (url.includes("[YOUR-PASSWORD]")) return false;
  return true;
}

export function getDbOrNull(): DrizzleDb | null {
  if (database) return database;
  if (!isDatabaseUrlConfigured()) return null;

  client = postgres(process.env.DATABASE_URL!, {
    // Required for Supabase pooler / serverless (Netlify, Vercel).
    prepare: false,
    max: process.env.NODE_ENV === "production" ? 3 : 5,
    idle_timeout: 20,
    connect_timeout: 15,
    max_lifetime: 60 * 30,
  });
  database = drizzle({ client, schema });
  return database;
}

export function getDatabaseUnavailableMessage(): string {
  return SERVICE_UNAVAILABLE.database;
}

export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const instance = getDbOrNull();
    if (!instance) {
      throw new Error(SERVICE_UNAVAILABLE.database);
    }

    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

/**
 * Runs database reads one at a time and returns their results in order.
 *
 * Use this instead of `Promise.all([...queries])`. `DATABASE_URL` points at
 * Supabase's *transaction-mode* pooler (port 6543), and postgres.js pipelines
 * concurrent queries down a single connection whenever the pool hands the same
 * connection to more than one in-flight query. That pooler answers only the
 * first pipelined query and silently drops the rest: the remaining promises
 * never resolve *and never reject*, so the caller hangs forever rather than
 * failing. On a server-rendered page that is a request that never responds —
 * which is exactly how `/customer/book` presented, as a page stuck loading.
 *
 * It is a race, not a constant. Whether two queries collide depends on how many
 * pool connections happen to be open at that moment, which is why it reproduced
 * in production (`max: 3`) but never in development (`max: 5`). Raising `max`
 * only lowers the odds; not pipelining is the fix.
 *
 * Sequential reads cost one round trip each (~200ms), which is the right price
 * for a request that completes at all.
 */
export async function sequentialQueries<
  T extends readonly (() => Promise<unknown>)[],
>(
  ...queries: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const results: unknown[] = [];
  for (const query of queries) {
    results.push(await query());
  }
  return results as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

export type Database = DrizzleDb;
export { schema };
