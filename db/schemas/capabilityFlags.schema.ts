import { pgTable, uuid, timestamp, boolean, unique } from "drizzle-orm/pg-core";
import { cleaners } from "./cleaners.schema";

export const capabilityFlags = pgTable('capability_flags', {
  id: uuid('id').primaryKey().defaultRandom(),
  cleanerId: uuid('cleaner_id').notNull().references(() => cleaners.id, { onDelete: 'cascade' }),
  hotTubCapable: boolean('hot_tub_capable').default(false).notNull(),
  laundryLeadEligible: boolean('laundry_lead_eligible').default(false).notNull(),
  teamLeaderEligible: boolean('team_leader_eligible').default(false).notNull(),
  ownsVehicle: boolean('owns_vehicle').default(false).notNull(),
  backgroundCheckPassed: boolean('background_check_passed').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('capability_flags_cleaner_unique').on(table.cleanerId),
]);