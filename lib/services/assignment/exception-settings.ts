import "server-only";

export const ASSIGNMENT_AUTOMATION_POLICY = "phase3a-complete-2026-11-13";
export const assignmentExceptionsReady = () => process.env.ASSIGNMENT_EXCEPTIONS_SCHEMA_READY === "true";
export const assignmentExceptionsEnrollment = () => assignmentExceptionsReady() && process.env.ASSIGNMENT_EXCEPTIONS_ENROLLMENT === "true" &&
  process.env.ASSIGNMENT_OFFERS_SCHEMA_READY === "true" && process.env.ASSIGNMENT_OFFERS_ENROLLMENT === "true" &&
  process.env.ASSIGNMENT_LIFECYCLE_SCHEMA_READY === "true" && process.env.ASSIGNMENT_LIFECYCLE_ENROLLMENT === "true";
