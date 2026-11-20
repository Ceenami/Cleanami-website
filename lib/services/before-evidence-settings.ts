import "server-only";
export const beforeEvidenceSchemaReady = () => process.env.BEFORE_EVIDENCE_SCHEMA_READY === "true";
export const beforeEvidenceEnabled = () => beforeEvidenceSchemaReady() && process.env.BEFORE_EVIDENCE_ENROLLMENT === "true";
