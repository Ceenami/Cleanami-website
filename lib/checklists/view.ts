import { z } from "zod";
import type { ChecklistSnapshot, IssuedChecklistItem } from "@/lib/cleaner/checklist-snapshot";
import { basicRentalDraft, buildRentalTasks, type RentalContext } from "./rental-library";

export const checklistItemsSchema = z.array(z.object({
  id: z.string().min(1), task: z.string().min(1), section: z.string().optional(),
})).superRefine((items, ctx) => {
  if (new Set(items.map(i => i.id)).size !== items.length)
    ctx.addIssue({ code: "custom", message: "Checklist contains duplicate task IDs" });
});
export function sameChecklist(a: IssuedChecklistItem[], b: IssuedChecklistItem[]) {
  return a.length === b.length && a.every(item => b.some(other => other.id === item.id && other.task === item.task && other.section === item.section));
}
export function rentalChecklistOrigin(items: IssuedChecklistItem[], context: RentalContext) {
  return sameChecklist(items, buildRentalTasks(context, basicRentalDraft(context))) ? "default" as const : "customer_custom" as const;
}
/** A published library selection can be custom even when snapshot.source is default. */
export function checklistSource(snapshot: ChecklistSnapshot, context?: RentalContext) {
  if (snapshot.source === "property_files") return "customer_custom" as const;
  if (snapshot.items.some(i => i.id.startsWith("custom-"))) return "customer_custom" as const;
  if (snapshot.origin) return snapshot.origin;
  if (snapshot.defaultVersion === "vr-library-v1")
    return context ? rentalChecklistOrigin(snapshot.items, context) : "unrecorded" as const;
  return snapshot.defaultVersion ? "default" as const : "unrecorded" as const;
}
export function safeChecklistUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export const checklistViewSchema = z.object({
  scope: z.enum(["property", "job"]),
  record: z.enum(["current", "issued", "legacy_record", "missing"]),
  source: z.enum(["default", "customer_custom", "unrecorded", "recorded", "missing"]),
  sourceLabel: z.string(),
  description: z.string(),
  revision: z.number().int().nonnegative().nullable(),
  executionRevision: z.number().int().nonnegative(),
  publicationNotice: z.string().nullable(),
  completion: z.enum(["submitted", "draft", "recorded"]).nullable(),
  items: z.array(z.object({ id: z.string(), task: z.string(), section: z.string().optional(), state: z.enum(["completed", "not_completed", "not_recorded"]) })),
  files: z.array(z.object({ id: z.string(), fileName: z.string(), url: z.string().refine(url => safeChecklistUrl(url) !== null).nullable() })),
});
export type ChecklistView = z.infer<typeof checklistViewSchema>;
export const CHECKLIST_SOURCE_LABELS = {
  default: "Default", customer_custom: "Customer Custom", missing: "Missing",
  unrecorded: "Issued source not recorded", recorded: "Recorded legacy checklist",
} as const;
