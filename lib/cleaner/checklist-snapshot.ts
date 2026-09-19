import { DEFAULT_CHECKLIST_ITEMS, type ChecklistItem } from "@/lib/constants/default-checklist";

export type IssuedChecklistItem = Pick<ChecklistItem, "id" | "task" | "section">;
export type IssuedChecklistFile = { id: string; fileName: string; storagePath: string | null; sourceUrl: string | null };

/** Immutable checklist data issued with a job, including any property guide. */
export type ChecklistSnapshot = {
  version: 1;
  source: "default" | "property_files";
  defaultVersion: "turnover-v2" | null;
  items: IssuedChecklistItem[];
  files: IssuedChecklistFile[];
};

export function createChecklistSnapshot(
  property: { useDefaultChecklist: boolean },
  files: IssuedChecklistFile[]
): ChecklistSnapshot {
  const copiedFiles = files.map(({ id, fileName, storagePath, sourceUrl }) => ({ id, fileName, storagePath, sourceUrl }));
  if (!property.useDefaultChecklist && copiedFiles.length > 0) {
    return {
      version: 1,
      source: "property_files",
      defaultVersion: null,
      items: copiedFiles.map((file) => ({ id: file.id, task: `Reviewed & completed: ${file.fileName}` })),
      files: copiedFiles,
    };
  }
  return {
    version: 1,
    source: "default",
    defaultVersion: "turnover-v2",
    items: DEFAULT_CHECKLIST_ITEMS.map(({ id, task, section }) => ({ id, task, section })),
    files: [],
  };
}

export function isChecklistSnapshot(value: unknown): value is ChecklistSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ChecklistSnapshot>;
  return snapshot.version === 1 && (snapshot.source === "default" || snapshot.source === "property_files") && Array.isArray(snapshot.items) && Array.isArray(snapshot.files);
}
