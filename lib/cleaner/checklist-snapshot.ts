import {
  DEFAULT_CHECKLIST_ITEMS,
  RESIDENTIAL_DEFAULT_CHECKLIST_ITEMS,
  type ChecklistItem,
} from "@/lib/constants/default-checklist";
import {
  getResidentialCompanyTasks,
  RESIDENTIAL_CHECKLIST_VERSION,
} from "@/lib/constants/residential-checklist";
import type { ResidentialCleaningLevel } from "@/lib/pricing/residential";
import { readResidentialSnapshot } from "@/lib/pricing/residential-v2/contracts";
import {
  getRoomPhotoRequirements,
  type RoomPhotoRequirement,
} from "@/lib/cleaner/evidence";

export type IssuedChecklistItem = Pick<
  ChecklistItem,
  "id" | "task" | "section"
>;
export type IssuedChecklistFile = {
  id: string;
  fileName: string;
  storagePath: string | null;
  sourceUrl: string | null;
};

/** Immutable checklist data issued with a job, including any property guide. */
export type ChecklistSnapshot = {
  version: 1;
  source: "default" | "property_files";
  defaultVersion:
    | "turnover-v2"
    | "vr-library-v1"
    | "residential-legacy"
    | "residential-company-v2"
    | typeof RESIDENTIAL_CHECKLIST_VERSION
    | null;
  propertyRevision?: number;
  cleaningLevel?: ResidentialCleaningLevel;
  photoRequirements?: RoomPhotoRequirement[];
  capabilityRequirements?: { hotTub: boolean; laundryLead: boolean };
  items: IssuedChecklistItem[];
  files: IssuedChecklistFile[];
};

export function createChecklistSnapshot(
  property: {
    useDefaultChecklist: boolean;
    serviceType?: string | null;
    cleaningLevel?: ResidentialCleaningLevel | null;
    bedCount?: number;
    bathCount?: string | number;
    hasHotTub?: boolean;
    laundryType?: string | null;
    residentialPricing?: unknown;
  },
  files: IssuedChecklistFile[],
): ChecklistSnapshot {
  const copiedFiles = files.map(({ id, fileName, storagePath, sourceUrl }) => ({
    id,
    fileName,
    storagePath,
    sourceUrl,
  }));
  const photoRequirements =
    property.bedCount !== undefined && property.bathCount !== undefined
      ? getRoomPhotoRequirements({
          bedCount: property.bedCount,
          bathCount: property.bathCount,
          hasHotTub: property.hasHotTub ?? false,
          laundryType: property.laundryType,
        })
      : undefined;
  if (property.serviceType === "residential_one_time") {
    const frozen = readResidentialSnapshot(
      property.residentialPricing === undefined
        ? null
        : { residentialPricing: property.residentialPricing },
    );
    if (frozen.kind === "v2") {
      const scope = frozen.terms.input;
      const items = getResidentialCompanyTasks(scope.cleaningLevel);
      if (scope.cleaningLevel === "deep")
        items.push(
          {
            id: "res-v2-oven-interior",
            section: "Kitchen",
            task: "Clean the oven interior (included in Deep).",
          },
          {
            id: "res-v2-fridge-interior",
            section: "Kitchen",
            task: "Clean the refrigerator interior (included in Deep).",
          },
        );
      if (scope.hotTub !== "none")
        items.push({
          id: `res-v2-spa-${scope.hotTub}`,
          section: "Hot Tub",
          task:
            scope.hotTub === "basic"
              ? "Complete purchased Basic hot-tub care."
              : "Complete purchased hot-tub drain, clean and refill.",
        });
      if (scope.inUnitLaundryLoads > 0)
        items.push({
          id: "res-v2-inunit-laundry",
          section: "Laundry",
          task: `Complete ${scope.inUnitLaundryLoads} purchased in-unit laundry load(s). No off-site laundry.`,
        });
      const photos = getRoomPhotoRequirements({
        bedCount: scope.bedrooms,
        bathCount: scope.bathrooms,
        hasHotTub: scope.hotTub !== "none",
        laundryType: "none",
      });
      // Existing room minimums stay. In-unit-specific proof requirements remain
      // an operational gate alongside elapsed-cycle feasibility, not a waiver.
      return {
        version: 1,
        source: "default",
        defaultVersion: "residential-company-v2",
        cleaningLevel: scope.cleaningLevel,
        photoRequirements: photos,
        capabilityRequirements: {
          hotTub: scope.hotTub !== "none",
          laundryLead: false,
        },
        items,
        files: [],
      };
    }
    return {
      version: 1,
      source: "default",
      photoRequirements,
      defaultVersion: property.cleaningLevel
        ? RESIDENTIAL_CHECKLIST_VERSION
        : "residential-legacy",
      ...(property.cleaningLevel
        ? { cleaningLevel: property.cleaningLevel }
        : {}),
      items: property.cleaningLevel
        ? getResidentialCompanyTasks(property.cleaningLevel)
        : RESIDENTIAL_DEFAULT_CHECKLIST_ITEMS.map(({ id, task, section }) => ({
            id,
            task,
            section,
          })),
      files: [],
    };
  }
  if (!property.useDefaultChecklist && copiedFiles.length > 0) {
    return {
      version: 1,
      source: "property_files",
      photoRequirements,
      defaultVersion: null,
      items: copiedFiles.map((file) => ({
        id: file.id,
        task: `Reviewed & completed: ${file.fileName}`,
      })),
      files: copiedFiles,
    };
  }
  return {
    version: 1,
    source: "default",
    photoRequirements,
    defaultVersion: "turnover-v2",
    items: DEFAULT_CHECKLIST_ITEMS.map(({ id, task, section }) => ({
      id,
      task,
      section,
    })),
    files: [],
  };
}

export function isChecklistSnapshot(
  value: unknown,
): value is ChecklistSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ChecklistSnapshot>;
  return (
    snapshot.version === 1 &&
    (snapshot.source === "default" || snapshot.source === "property_files") &&
    Array.isArray(snapshot.items) &&
    Array.isArray(snapshot.files)
  );
}
