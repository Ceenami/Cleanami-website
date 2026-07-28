/**
 * Single source of truth for checklist upload constraints. Previously the
 * customer signup form, the onboarding-completion server validation, and the
 * admin checklist-management action each hardcoded their own (different, and
 * disagreeing) allowlist — a file accepted by one layer's file picker could
 * fail a different layer's server-side check. Phase 7 requires PDF/DOCX/Excel/
 * JPG/PNG support everywhere checklists are uploaded.
 */
export const CHECKLIST_ALLOWED_MIME_TYPES: readonly string[] = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/vnd.oasis.opendocument.spreadsheet",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

export const CHECKLIST_ACCEPT_ATTR =
  ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ods,.jpg,.jpeg,.png,.webp";

export const CHECKLIST_TYPES_HELP_TEXT =
  "PDF, Word, Excel, JPG, PNG or WebP, up to 10MB";

export const CHECKLIST_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
