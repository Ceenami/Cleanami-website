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

export type Database = DrizzleDb;
export { schema };
