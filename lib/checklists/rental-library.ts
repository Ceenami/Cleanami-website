import { z } from "zod";
import { DEFAULT_CHECKLIST_ITEMS } from "@/lib/constants/default-checklist";
import type { IssuedChecklistItem } from "@/lib/cleaner/checklist-snapshot";

export const RENTAL_LIBRARY_VERSION = "vr-library-v1" as const;
const essentials = new Set([
  "t1",
  "t2",
  "t3",
  "t4",
  "t10",
  "t16",
  "t22",
  "t27",
  "t41",
  "t42",
  "t43",
  "t44",
  "t45",
  "t46",
  "t47",
  "t48",
  "t49",
]);
export type RentalContext = {
  hotTubService?: boolean | null;
  hotTubServiceLevel?: boolean | null;
  laundryType?: string | null;
  petsAllowed?: boolean | null;
};
export function rentalLibrary(context: RentalContext) {
  return DEFAULT_CHECKLIST_ITEMS.filter((item) => {
    if (["t37", "t38"].includes(item.id))
      return (context.hotTubServiceLevel ?? context.hotTubService) === true;
    if (["t39", "t40"].includes(item.id)) return context.petsAllowed === true;
    if (["t28", "t29", "t30", "t31", "t32"].includes(item.id))
      return context.laundryType !== "none";
    return true;
  }).map((item) => ({
    ...item,
    section: ["t37", "t38"].includes(item.id)
      ? "Hot Tub"
      : ["t39", "t40"].includes(item.id)
        ? "Pet Homes"
        : item.section,
    mandatory:
      essentials.has(item.id) ||
      ["t37", "t38"].includes(item.id) ||
      (context.laundryType === "off_site" &&
        ["t28", "t29", "t30", "t32"].includes(item.id)),
  }));
}
export const checklistDraftSchema = z
  .object({
    libraryIds: z.array(z.string().regex(/^t\d+$/)).max(49),
    customTasks: z
      .array(
        z.object({
          id: z.string().regex(/^custom-[a-zA-Z0-9-]{1,64}$/),
          task: z.string().trim().min(3).max(300),
          section: z.string().trim().min(1).max(60),
        }),
      )
      .max(40),
  })
  .strict();
export type ChecklistDraft = z.infer<typeof checklistDraftSchema>;
/** Reusing approved custom tasks does not turn a library-only edit into review. */
export function canPublishRentalDraft(
  draft: ChecklistDraft,
  published: IssuedChecklistItem[] | null | undefined,
): boolean {
  return draft.customTasks.every((task) =>
    published?.some(
      (approved) =>
        approved.id === task.id &&
        approved.task === task.task &&
        approved.section === task.section,
    ),
  );
}
export function buildRentalTasks(
  context: RentalContext,
  input: ChecklistDraft,
): IssuedChecklistItem[] {
  const draft = checklistDraftSchema.parse(input);
  const library = rentalLibrary(context);
  const byId = new Map(library.map((item) => [item.id, item]));
  if (
    new Set(draft.libraryIds).size !== draft.libraryIds.length ||
    new Set(draft.customTasks.map((t) => t.id)).size !==
      draft.customTasks.length
  )
    throw new Error("Duplicate task IDs");
  if (draft.libraryIds.some((id) => !byId.has(id)))
    throw new Error("Task is not applicable to this property's services");
  const selected = new Set(draft.libraryIds);
  if (library.some((item) => item.mandatory && !selected.has(item.id)))
    throw new Error("Company essential tasks cannot be removed");
  return [
    ...library
      .filter((item) => selected.has(item.id))
      .map(({ id, task, section }) => ({ id, task, section })),
    ...draft.customTasks.map((item) => ({ ...item })),
  ];
}
export function basicRentalDraft(context: RentalContext): ChecklistDraft {
  return {
    libraryIds: rentalLibrary(context).map((item) => item.id),
    customTasks: [],
  };
}
