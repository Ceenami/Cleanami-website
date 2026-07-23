import type { Property } from "@/db/schemas/properties.schema";

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
