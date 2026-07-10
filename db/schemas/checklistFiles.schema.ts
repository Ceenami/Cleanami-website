import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { properties } from "./properties.schema";

export const checklistFiles = pgTable("checklist_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storagePath: text("storage_path").notNull().unique(),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChecklistFileSchema = createInsertSchema(checklistFiles);
export const selectChecklistFileSchema = createSelectSchema(checklistFiles);

export type ChecklistFile = z.infer<typeof selectChecklistFileSchema>;
export type NewChecklistFile = z.infer<typeof insertChecklistFileSchema>;
