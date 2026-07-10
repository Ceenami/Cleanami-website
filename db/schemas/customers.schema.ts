import { pgTable, uuid, text, timestamp, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Uncomment below if you want to add customer authentication
    // this links customer auth to their data
    // supabaseUserId: uuid('supabase_user_id').notNull().unique(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone_number"),
    stripeCustomerId: text("stripe_customer_id").unique(),
    skipPayment: boolean("skip_payment").default(false).notNull(),
    portalAccessEnabled: boolean("portal_access_enabled").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("customers_email_idx").on(table.email),
    index("customers_stripe_idx").on(table.stripeCustomerId),
  ]
);

export const insertCustomerSchema = createInsertSchema(customers, {
  name: z.string().min(1, { message: "Name is required" }),
  email: z
    .email({ message: "Invalid email address" })
    .min(1, { message: "Email is required" }),
  phone: z.string().optional(),
});
export const selectCustomerSchema = createSelectSchema(customers);

export type Customer = z.infer<typeof selectCustomerSchema>;
export type NewCustomer = z.infer<typeof insertCustomerSchema>;
