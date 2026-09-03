export type ChecklistItem = { id: string; task: string; completed: boolean; section?: string };

/**
 * The vacation-rental turnover checklist. **Unchanged** — a residential job
 * gets `RESIDENTIAL_DEFAULT_CHECKLIST_ITEMS` below instead.
 *
 * Item 18 asked where this lives and whether admin can edit it. The answers are
 * "here, in code" and "no": it is a constant, deployed with the app, and there
 * is no admin editor for it. A property that wants its own uploads one
 * (`checklist_files`), which is a different and already-supported path.
 */
export const DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "t1", section: "Section 1 - Arrival / Before Photos", task: "Check in through the app/website.", completed: false },
  { id: "t2", section: "Section 1 - Arrival / Before Photos", task: "Review property notes, access instructions, laundry instructions, hot tub instructions, and any customer-uploaded checklist.", completed: false },
  { id: "t3", section: "Section 1 - Arrival / Before Photos", task: "Take before photos of the property before cleaning, especially any damage, excessive mess, stains, trash, guest belongings, or unusual issues.", completed: false },
  { id: "t4", section: "Section 1 - Arrival / Before Photos", task: "Report urgent issues in the notes section before continuing.", completed: false },
  { id: "t5", section: "Section 2 - Kitchen", task: "Wash/load dishes and check for dishes left in other rooms.", completed: false },
  { id: "t6", section: "Section 2 - Kitchen", task: "Clean sink, counters, backsplash, stovetop, microwave, and appliance exteriors.", completed: false },
  { id: "t7", section: "Section 2 - Kitchen", task: "Check fridge, oven, cabinets, and drawers for leftover food, dirty dishes, obvious mess, or misplaced items.", completed: false },
  { id: "t8", section: "Section 2 - Kitchen", task: "Empty kitchen trash and replace liner.", completed: false },
  { id: "t9", section: "Section 2 - Kitchen", task: "Restock kitchen supplies if available, including paper towels, trash bags, dish soap, sponge, coffee supplies, and other provided items.", completed: false },
  { id: "t10", section: "Section 2 - Kitchen", task: "Upload kitchen after photos.", completed: false },
  { id: "t11", section: "Section 3 - Bathrooms", task: "Clean and disinfect toilets, sinks, counters, mirrors, showers, tubs, and bathroom fixtures.", completed: false },
  { id: "t12", section: "Section 3 - Bathrooms", task: "Remove hair from drains, showers, tubs, sinks, counters, and floors.", completed: false },
  { id: "t13", section: "Section 3 - Bathrooms", task: "Replace towels according to property instructions.", completed: false },
  { id: "t14", section: "Section 3 - Bathrooms", task: "Restock toilet paper, hand soap, shampoo/body wash, and other provided bathroom supplies if available.", completed: false },
  { id: "t15", section: "Section 3 - Bathrooms", task: "Empty bathroom trash and clean bathroom floors.", completed: false },
  { id: "t16", section: "Section 3 - Bathrooms", task: "Upload bathroom after photos.", completed: false },
  { id: "t17", section: "Section 4 - Bedrooms", task: "Strip used linens if applicable and replace with clean linens.", completed: false },
  { id: "t18", section: "Section 4 - Bedrooms", task: "Make beds neatly and stage pillows/blankets/decor properly.", completed: false },
  { id: "t19", section: "Section 4 - Bedrooms", task: "Check under beds, nightstands, drawers, closets, and shelves for trash or guest belongings.", completed: false },
  { id: "t20", section: "Section 4 - Bedrooms", task: "Dust/wipe visible bedroom surfaces.", completed: false },
  { id: "t21", section: "Section 4 - Bedrooms", task: "Vacuum/sweep/mop bedroom floors.", completed: false },
  { id: "t22", section: "Section 4 - Bedrooms", task: "Upload bedroom after photos.", completed: false },
  { id: "t23", section: "Section 5 - Living Room / Common Areas", task: "Dust/wipe tables, TV stand, shelves, remotes, and visible surfaces.", completed: false },
  { id: "t24", section: "Section 5 - Living Room / Common Areas", task: "Straighten couches, pillows, throws, games, guest materials, and decor.", completed: false },
  { id: "t25", section: "Section 5 - Living Room / Common Areas", task: "Check couches/chairs for crumbs, stains, trash, pet hair, or guest belongings.", completed: false },
  { id: "t26", section: "Section 5 - Living Room / Common Areas", task: "Vacuum rugs/carpets and clean hard floors.", completed: false },
  { id: "t27", section: "Section 5 - Living Room / Common Areas", task: "Upload living room/common area after photos.", completed: false },
  { id: "t28", section: "Section 6 - Laundry / Linens", task: "Follow the property laundry instructions.", completed: false },
  { id: "t29", section: "Section 6 - Laundry / Linens", task: "Start, complete, or prepare laundry as required for the property.", completed: false },
  { id: "t30", section: "Section 6 - Laundry / Linens", task: "Place clean linens/towels where instructed.", completed: false },
  { id: "t31", section: "Section 6 - Laundry / Linens", task: "Report missing, low, damaged, or stained linens/towels in the notes section.", completed: false },
  { id: "t32", section: "Section 6 - Laundry / Linens", task: "Upload laundry proof if laundry is part of the job.", completed: false },
  { id: "t33", section: "Section 7 - Exterior / Entry / Patio", task: "Check the front entry, porch, patio, balcony, or outdoor area if included with the property.", completed: false },
  { id: "t34", section: "Section 7 - Exterior / Entry / Patio", task: "Remove visible trash and straighten outdoor furniture.", completed: false },
  { id: "t35", section: "Section 7 - Exterior / Entry / Patio", task: "Check grill, fire pit, outdoor furniture, or exterior items if applicable and report problems in notes.", completed: false },
  { id: "t36", section: "Section 7 - Exterior / Entry / Patio", task: "Upload exterior/patio photos if applicable.", completed: false },
  { id: "t37", section: "Section 8 - Hot Tub / Pet Property - If Applicable", task: "If hot tub service is included, complete the required hot tub steps according to property/service instructions.", completed: false },
  { id: "t38", section: "Section 8 - Hot Tub / Pet Property - If Applicable", task: "Upload hot tub proof photos if hot tub service is included.", completed: false },
  { id: "t39", section: "Section 8 - Hot Tub / Pet Property - If Applicable", task: "If pets are allowed or present, check floors, rugs, couches, beds, corners, and baseboards for pet hair.", completed: false },
  { id: "t40", section: "Section 8 - Hot Tub / Pet Property - If Applicable", task: "Report excessive pet hair, pet mess, or pet damage in the notes section.", completed: false },
  { id: "t41", section: "Section 9 - Restocking / Issues", task: "Check for low or missing supplies, including toilet paper, paper towels, trash bags, soap, dish soap, sponge, coffee supplies, shampoo/body wash, laundry detergent, towels, and linens.", completed: false },
  { id: "t42", section: "Section 9 - Restocking / Issues", task: "Add restocking needs to the notes/issues section.", completed: false },
  { id: "t43", section: "Section 9 - Restocking / Issues", task: "Report damage, hazards, missing items, stains, broken items, access issues, or anything unusual in the notes/issues section.", completed: false },
  { id: "t44", section: "Section 10 - Final Walkthrough", task: "Confirm all rooms are clean, staged, and guest-ready.", completed: false },
  { id: "t45", section: "Section 10 - Final Walkthrough", task: "Confirm all trash is removed and liners are replaced.", completed: false },
  { id: "t46", section: "Section 10 - Final Walkthrough", task: "Confirm beds, towels, supplies, remotes, guest materials, lights, thermostat, doors, and windows are set according to property instructions.", completed: false },
  { id: "t47", section: "Section 10 - Final Walkthrough", task: "Confirm no obvious guest belongings were left behind.", completed: false },
  { id: "t48", section: "Section 10 - Final Walkthrough", task: "Upload final after photos.", completed: false },
  { id: "t49", section: "Section 10 - Final Walkthrough", task: "Check out through the app/website.", completed: false },
];

/**
 * The one-time residential checklist — counterproposal item 18.
 *
 * Four of the nine turnover items are wrong in a home somebody lives in, and
 * wrong in a way a cleaner would have to ignore rather than complete:
 *
 * - *"Make all beds with fresh linens"* — a resident's linens are not ours to
 *   change, and stripping their bed is worse than not touching it.
 * - *"Stage living room pillows and throws per property guide"* — there is no
 *   property guide, and a home is not staged for arrival.
 * - *"Restock toiletries and paper products"* — we do not supply a home's
 *   consumables.
 * - *"Final walkthrough - property guest-ready"* — there is no guest.
 *
 * **The ids are `r1`-`r8`, deliberately not `d1`-`d9`.** `mergeChecklistItems`
 * overlays prior completion state **by id**, so reusing the turnover ids would
 * let a tick recorded against one checklist appear pre-completed on the other.
 *
 * This is a code constant, like the turnover list. Admin cannot edit it, and
 * item 18 does not ask for that — an admin-editable checklist is on the
 * counterproposal's own Phase 3 list.
 */
export const RESIDENTIAL_DEFAULT_CHECKLIST_ITEMS: ChecklistItem[] = [
  { id: "r1", task: "Dust all surfaces in living areas and bedrooms.", completed: false },
  { id: "r2", task: "Vacuum all carpets and rugs.", completed: false },
  { id: "r3", task: "Sweep and mop all hard floors.", completed: false },
  { id: "r4", task: "Clean and disinfect all bathroom surfaces (sinks, toilets, showers, tubs).", completed: false },
  { id: "r5", task: "Wipe kitchen counters, appliance exteriors, and sink.", completed: false },
  { id: "r6", task: "Wipe interior door handles, light switches, and other high-touch points.", completed: false },
  { id: "r7", task: "Take out trash and replace liners.", completed: false },
  { id: "r8", task: "Final walkthrough - all rooms clean and tidy, nothing of the customer's moved or removed.", completed: false },
];
