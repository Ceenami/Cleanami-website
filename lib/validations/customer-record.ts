import { z } from "zod";

/** Postgres UUID format (less strict than Zod's RFC-only `.uuid()`). */
export const propertyIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    "Invalid property record"
  );

export const adminCustomerUpdateSchema = z
  .object({
    name: z.string().min(1, "Name is required").optional(),
    email: z.string().email("Invalid email").optional(),
    phone: z.string().nullable().optional(),
  })
  .refine((data) => data.name ?? data.email ?? data.phone !== undefined, {
    message: "At least one field is required",
  });

export const customerSelfUpdateSchema = z
  .object({
    email: z.string().email("Invalid email").optional(),
    phone: z.string().nullable().optional(),
  })
  .refine((data) => data.email !== undefined || data.phone !== undefined, {
    message: "At least one field is required",
  });

export const mergePropertiesSchema = z.object({
  sourcePropertyId: propertyIdSchema,
  targetPropertyId: propertyIdSchema,
});

export const deletePropertyParamsSchema = z.object({
  propertyId: propertyIdSchema,
});
