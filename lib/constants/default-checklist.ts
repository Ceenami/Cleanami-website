export type ChecklistItem = {
  id: string;
  task: string;
  completed: boolean;
};

export const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "d1", task: "Dust all surfaces in living room and bedrooms.", completed: false },
  { id: "d2", task: "Vacuum all carpets and rugs.", completed: false },
  { id: "d3", task: "Clean and disinfect all bathroom surfaces (sinks, toilets, showers).", completed: false },
  { id: "d4", task: "Wipe kitchen counters, appliances, and sink.", completed: false },
  { id: "d5", task: "Make all beds with fresh linens.", completed: false },
  { id: "d6", task: "Stage living room pillows and throws per property guide.", completed: false },
  { id: "d7", task: "Restock toiletries and paper products.", completed: false },
  { id: "d8", task: "Take out trash and replace liners.", completed: false },
  { id: "d9", task: "Final walkthrough — property guest-ready.", completed: false },
];
