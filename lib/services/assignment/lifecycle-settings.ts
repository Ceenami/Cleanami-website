import "server-only";

export const lifecycleSchemaReady = () =>
  process.env.ASSIGNMENT_OFFERS_SCHEMA_READY === "true" &&
  process.env.ASSIGNMENT_LIFECYCLE_SCHEMA_READY === "true";

export const lifecycleEnrollmentEnabled = () => lifecycleSchemaReady() &&
  process.env.ASSIGNMENT_LIFECYCLE_ENROLLMENT === "true";
