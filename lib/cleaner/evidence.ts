import type { Property } from "@/db/schemas/properties.schema";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/constants/default-checklist";

export type RoomPhotoRequirement = {
  roomKey: string;
  label: string;
  minPhotos: number;
};

export function getRoomPhotoRequirements(property: {
  bedCount: number;
  bathCount: string | number;
  hasHotTub: boolean;
  laundryType?: string | null;
}): RoomPhotoRequirement[] {
  const requirements: RoomPhotoRequirement[] = [];
  const bathCount = Math.ceil(parseFloat(String(property.bathCount)));

  for (let i = 1; i <= property.bedCount; i++) {
    requirements.push({
      roomKey: `bedroom-${i}`,
      label: `Bedroom ${i}`,
      minPhotos: 1,
    });
  }

  for (let i = 1; i <= bathCount; i++) {
    requirements.push({
      roomKey: `bathroom-${i}`,
      label: `Bathroom ${i}`,
      minPhotos: 2,
    });
  }

  requirements.push({
    roomKey: "living",
    label: "Living area",
    minPhotos: 1,
  });

  // Spec §14.1: 1 photo per room — bedroom, kitchen, living area, hallway. Bed
  // rooms are counted above; a property always has one kitchen and one hallway
  // for evidence purposes (the schema does not track their counts).
  requirements.push({
    roomKey: "kitchen",
    label: "Kitchen",
    minPhotos: 1,
  });

  requirements.push({
    roomKey: "hallway",
    label: "Hallway",
    minPhotos: 1,
  });

  if (property.hasHotTub) {
    requirements.push({
      roomKey: "hot-tub",
      label: "Hot tub",
      minPhotos: 2,
    });
  }

  // Off-site laundry needs proof it was actually done (spec §14.1): a single
  // receipt or machine-in-use photo. In-unit / no laundry needs nothing extra.
  if (property.laundryType === "off_site") {
    requirements.push({
      roomKey: "laundry",
      label: "Laundry (receipt or machine-in-use)",
      minPhotos: 1,
    });
  }

  return requirements;
}

export type RoomPhotosMap = Record<string, string[]>;

export type ChecklistLogPayload = {
  items: { id: string; task: string; completed: boolean }[];
  roomPhotos?: RoomPhotosMap;
};

export function getMissingPhotoRequirements(
  requirements: RoomPhotoRequirement[],
  roomPhotos: RoomPhotosMap
): string[] {
  const missing: string[] = [];

  for (const req of requirements) {
    const count = roomPhotos[req.roomKey]?.length ?? 0;
    if (count < req.minPhotos) {
      missing.push(
        `${req.label}: ${count}/${req.minPhotos} photo${req.minPhotos > 1 ? "s" : ""}`
      );
    }
  }

  return missing;
}

export function flattenRoomPhotos(roomPhotos: RoomPhotosMap): string[] {
  return Object.values(roomPhotos).flat();
}

export type ExpectedChecklistItem = { id: string; task: string };

/**
 * Spec §14.1/§14.2: a property with its own uploaded checklist
 * (`useDefaultChecklist = false`) must have the cleaner review and check off
 * that specific checklist, not the generic system default. `checklist_files`
 * stores documents (PDF/photo), not structured line items, so each uploaded
 * file becomes one review-and-confirm item. Falls back to the system default
 * when the property opts into it, or when it opts out but nothing has been
 * uploaded yet (fail open — an admin oversight shouldn't block a job).
 */
export function getExpectedChecklistItems(
  property: Pick<Property, "useDefaultChecklist">,
  checklistFiles: { id: string; fileName: string }[]
): ExpectedChecklistItem[] {
  if (!property.useDefaultChecklist && checklistFiles.length > 0) {
    return checklistFiles.map((file) => ({
      id: file.id,
      task: `Reviewed & completed: ${file.fileName}`,
    }));
  }
  return DEFAULT_CHECKLIST_ITEMS.map(({ id, task }) => ({ id, task }));
}

/** Recomputes the expected items and overlays any prior completion state by id. */
export function mergeChecklistItems(
  expected: ExpectedChecklistItem[],
  existing: { id: string; completed: boolean }[]
): { id: string; task: string; completed: boolean }[] {
  const completedById = new Map(existing.map((item) => [item.id, item.completed]));
  return expected.map((item) => ({
    ...item,
    completed: completedById.get(item.id) ?? false,
  }));
}

/** Every expected item's id must appear, completed, in the submission. */
export function getMissingChecklistItems(
  expected: ExpectedChecklistItem[],
  submitted: { id: string; completed: boolean }[]
): string[] {
  const completedIds = new Set(
    submitted.filter((item) => item.completed).map((item) => item.id)
  );
  return expected
    .filter((item) => !completedIds.has(item.id))
    .map((item) => item.task);
}

export function validateEvidenceComplete(
  evidence: {
    isChecklistComplete: boolean | null;
    checklistLog: unknown;
    photoUrls: string[] | null;
  },
  property: Pick<Property, "bedCount" | "bathCount" | "hasHotTub" | "laundryType">
): { valid: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!evidence.isChecklistComplete) {
    missing.push("Checklist not marked complete");
  }

  const log = evidence.checklistLog as ChecklistLogPayload | null;
  const roomPhotos = log?.roomPhotos ?? {};
  const requirements = getRoomPhotoRequirements(property);
  missing.push(...getMissingPhotoRequirements(requirements, roomPhotos));

  if (!evidence.photoUrls?.length && flattenRoomPhotos(roomPhotos).length === 0) {
    missing.push("No photos uploaded");
  }

  return { valid: missing.length === 0, missing };
}
