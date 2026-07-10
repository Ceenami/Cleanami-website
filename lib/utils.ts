import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { ZodError } from "zod";

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

  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  ) {
    const constraintName =
      "constraint" in error && typeof error.constraint === "string"
        ? error.constraint
        : "";
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