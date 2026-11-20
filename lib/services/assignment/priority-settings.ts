import "server-only";

export const prioritySchemaReady = () => process.env.ASSIGNMENT_OFFERS_SCHEMA_READY === "true" && process.env.ASSIGNMENT_PRIORITY_SCHEMA_READY === "true";
export const priorityEnrollmentEnabled = () => prioritySchemaReady() && process.env.ASSIGNMENT_OFFERS_ENROLLMENT === "true" && process.env.ASSIGNMENT_PRIORITY_ENROLLMENT === "true";
