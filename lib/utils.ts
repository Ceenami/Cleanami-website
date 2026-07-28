import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ZodError } from "zod";
import { isUniqueViolation, pgConstraintName } from "@/lib/db/errors";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function formatError(error: unknown) {
  if (error instanceof ZodError) {
    const fieldErrors = error.issues.map(
      (issue) => issue.message
    );
    return fieldErrors.join('. ');
  }

  // Note: the Postgres error is usually wrapped by Drizzle, so this must look
  // through the cause chain rather than at `error.code` directly — see
  // lib/db/errors.ts.
  if (isUniqueViolation(error)) {
    const constraintName = pgConstraintName(error) ?? "";
    if (constraintName.includes("email")) {
      return "Email already exists";
    }
    return "Record already exists";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "An unexpected error occurred";
}