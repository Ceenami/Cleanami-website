import type { IssuedChecklistItem } from "@/lib/cleaner/checklist-snapshot";
import type { ResidentialCleaningLevel } from "@/lib/pricing/residential";

export const RESIDENTIAL_CHECKLIST_VERSION = "residential-company-v1" as const;
const operational: IssuedChecklistItem[] = [
  {
    id: "res-v1-arrival",
    section: "Arrival",
    task: "Check in through the app/website and review the property instructions.",
  },
];
const standard: IssuedChecklistItem[] = [
  {
    id: "res-v1-kitchen",
    section: "Kitchen",
    task: "Complete routine kitchen cleaning.",
  },
  {
    id: "res-v1-bathrooms",
    section: "Bathrooms",
    task: "Complete routine bathroom cleaning.",
  },
  {
    id: "res-v1-dusting",
    section: "Living / Common Areas",
    task: "Dust reachable surfaces.",
  },
  {
    id: "res-v1-appliances",
    section: "Kitchen",
    task: "Clean appliance exteriors.",
  },
  { id: "res-v1-vacuum", section: "Floors", task: "Vacuum floors." },
  { id: "res-v1-mop", section: "Floors", task: "Mop appropriate floors." },
  {
    id: "res-v1-rubbish",
    section: "Living / Common Areas",
    task: "Remove rubbish.",
  },
  {
    id: "res-v1-living",
    section: "Living / Common Areas",
    task: "Complete normal cleaning of living areas.",
  },
];
const deep: IssuedChecklistItem[] = [
  {
    id: "res-v1-baseboards",
    section: "Deep Clean Details",
    task: "Clean baseboards.",
  },
  {
    id: "res-v1-doors",
    section: "Deep Clean Details",
    task: "Clean doors and frames.",
  },
  {
    id: "res-v1-vents",
    section: "Deep Clean Details",
    task: "Clean reachable vents and fans.",
  },
  {
    id: "res-v1-windows",
    section: "Deep Clean Details",
    task: "Clean window sills and tracks.",
  },
  { id: "res-v1-cabinets", section: "Kitchen", task: "Clean cabinet fronts." },
  {
    id: "res-v1-kitchen-buildup",
    section: "Kitchen",
    task: "Give detailed attention to kitchen buildup.",
  },
  {
    id: "res-v1-bathroom-buildup",
    section: "Bathrooms",
    task: "Give detailed attention to bathroom buildup.",
  },
  {
    id: "res-v1-edges",
    section: "Deep Clean Details",
    task: "Clean edges and corners.",
  },
  {
    id: "res-v1-accessible",
    section: "Deep Clean Details",
    task: "Clean under and behind accessible items.",
  },
];
const final: IssuedChecklistItem[] = [
  {
    id: "res-v1-walkthrough",
    section: "Final Walkthrough",
    task: "Complete the final walkthrough, required evidence and issue notes.",
  },
  {
    id: "res-v1-departure",
    section: "Final Walkthrough",
    task: "Secure the property as instructed and record departure through the app/website.",
  },
];

export function getResidentialCompanyTasks(
  level: ResidentialCleaningLevel,
): IssuedChecklistItem[] {
  return [
    ...operational,
    ...standard,
    ...(level === "deep" ? deep : []),
    ...final,
  ].map((item) => ({ ...item }));
}
