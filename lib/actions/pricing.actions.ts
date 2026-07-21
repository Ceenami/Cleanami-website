"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminAuth } from "@/lib/admin-auth";
import { db } from "@/db";
import {
  pricingUploads,
  basePricingRules,
  sqftSurchargeRules,
  laundryPricingRules,
  hotTubPricingRules,
} from "@/db/schemas";
import { eq } from "drizzle-orm";
import Papa from "papaparse";
import { revalidateTag } from "next/cache";

export type PricingFileType =
  | "base_prices"
  | "sqft_surcharges"
  | "laundry_pricing"
  | "hot_tub_pricing";

/** Parse a numeric cell, throwing on any non-finite value (rejects NaN). */
function toFiniteNumber(value: unknown, field: string): number {
  const n = typeof value === "string" ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid numeric value for ${field}: "${String(value)}"`);
  }
  return n;
}

/** Parse a dollar cell into integer cents, throwing on any invalid value. */
function toCents(value: unknown, field: string): number {
  return Math.round(toFiniteNumber(value, field) * 100);
}

/** Parse an integer cell, throwing on non-integer / invalid values. */
function toInt(value: unknown, field: string): number {
  const n = toFiniteNumber(value, field);
  if (!Number.isInteger(n)) {
    throw new Error(`Expected a whole number for ${field}: "${String(value)}"`);
  }
  return n;
}

/** Require a non-empty string cell. */
function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing value for ${field}`);
  }
  return value.trim();
}

/** Require a cell whose value is one of an allowed enum set. */
function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string
): T {
  const s = requireString(value, field);
  if (!(allowed as readonly string[]).includes(s)) {
    throw new Error(
      `Invalid ${field}: "${s}". Expected one of: ${allowed.join(", ")}`
    );
  }
  return s as T;
}

export async function handleFileUpload(
  formData: FormData,
  fileType: PricingFileType
): Promise<{
  success: boolean;
  message: string;
}> {
  // Admin-only: this rewrites every pricing table (2.3 / PAY-8).
  const { isAdmin } = await getAdminAuth();
  if (!isAdmin) {
    return {
      success: false,
      message: "Unauthorized: admin access required.",
    };
  }

  const supabase = await createClient();

  const file = formData.get("pricingCsv") as File;
  if (!file) {
    return { success: false, message: "No file was provided." };
  }

  let uploadRecord;
  try {
    [uploadRecord] = await db
      .insert(pricingUploads)
      .values({
        fileName: file.name,
        fileUrl: "pending",
        status: "processing",
      })
      .returning();
  } catch (error) {
    console.error("Failed to create initial upload record:", error);
    return { success: false, message: "Error initializing upload." };
  }

  try {
    const filePath = `pricing_csvs/${fileType}_${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage
      .from("pricing-files")
      .upload(filePath, file);

    if (uploadError) {
      throw new Error(`Storage Error: ${uploadError.message}`);
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from("pricing-files").getPublicUrl(filePath);

    await db
      .update(pricingUploads)
      .set({ fileUrl: publicUrl })
      .where(eq(pricingUploads.id, uploadRecord.id));

    const fileContent = await file.text();
    const parsedCsv = Papa.parse<Record<string, unknown>>(fileContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsedCsv.errors.length > 0) {
      throw new Error(`CSV Parsing Error: ${parsedCsv.errors[0].message}`);
    }

    const rows = parsedCsv.data;
    if (rows.length === 0) {
      throw new Error("The uploaded file has no data rows.");
    }

    await db.transaction(async (tx) => {
      // IMPORTANT: build + validate EVERY row (throws on any NaN / parse
      // failure) BEFORE the destructive delete. `rows.map(...)` runs before
      // `tx.delete(...)`, so a malformed file aborts the transaction with the
      // pricing table untouched — a bad upload can no longer corrupt prices
      // (2.3 / PAY-8).
      switch (fileType) {
        case "base_prices": {
          const values = rows.map((row, i) => ({
            bedrooms: toInt(row.Bedrooms, `row ${i + 1} Bedrooms`),
            price1BathCents: toCents(row["1_Bath"], `row ${i + 1} 1_Bath`),
            price2BathCents: toCents(row["2_Bath"], `row ${i + 1} 2_Bath`),
            price3BathCents: toCents(row["3_Bath"], `row ${i + 1} 3_Bath`),
            price4BathCents: toCents(row["4_Bath"], `row ${i + 1} 4_Bath`),
            price5BathCents: toCents(row["5_Bath"], `row ${i + 1} 5_Bath`),
          }));
          await tx.delete(basePricingRules);
          await tx.insert(basePricingRules).values(values);
          break;
        }
        case "sqft_surcharges": {
          const values = rows.map((row, i) => {
            const surcharge = requireString(
              row.Surcharge_Amount,
              `row ${i + 1} Surcharge_Amount`
            );
            const isCustomQuote = surcharge.toLowerCase() === "custom quote";
            return {
              rangeStart: toInt(row.Range_Start, `row ${i + 1} Range_Start`),
              rangeEnd: toInt(row.Range_End, `row ${i + 1} Range_End`),
              surchargeCents: isCustomQuote
                ? 0
                : toCents(surcharge, `row ${i + 1} Surcharge_Amount`),
              isCustomQuote,
            };
          });
          await tx.delete(sqftSurchargeRules);
          await tx.insert(sqftSurchargeRules).values(values);
          break;
        }
        case "laundry_pricing": {
          const values = rows.map((row, i) => ({
            serviceType: requireEnum(
              row.Service_Type,
              ["In-Unit", "Off-Site"] as const,
              `row ${i + 1} Service_Type`
            ),
            customerRevenueBaseCents: toCents(
              row.Customer_Revenue_Base,
              `row ${i + 1} Customer_Revenue_Base`
            ),
            customerRevenuePerLoadCents: toCents(
              row.Customer_Revenue_Per_Load,
              `row ${i + 1} Customer_Revenue_Per_Load`
            ),
            cleanerBonusPerLoadCents: toCents(
              row.Cleaner_Bonus_Per_Load,
              `row ${i + 1} Cleaner_Bonus_Per_Load`
            ),
          }));
          await tx.delete(laundryPricingRules);
          await tx.insert(laundryPricingRules).values(values);
          break;
        }
        case "hot_tub_pricing": {
          const values = rows.map((row, i) => ({
            serviceType: requireEnum(
              row.Service_Type,
              ["Basic", "Full_Drain"] as const,
              `row ${i + 1} Service_Type`
            ),
            customerRevenueCents: toCents(
              row.Customer_Revenue,
              `row ${i + 1} Customer_Revenue`
            ),
            timeAddHours: requireString(
              row.Time_Add_Hours,
              `row ${i + 1} Time_Add_Hours`
            ),
          }));
          await tx.delete(hotTubPricingRules);
          await tx.insert(hotTubPricingRules).values(values);
          break;
        }
        default:
          throw new Error("Invalid pricing file type specified.");
      }
    });

    await db
      .update(pricingUploads)
      .set({ status: "success" })
      .where(eq(pricingUploads.id, uploadRecord.id));

    // --- FINAL STEP: Invalidate the cache ---
    revalidateTag("pricing_rules");

    return { success: true, message: "Pricing updated successfully!" };
  } catch (error: any) {
    console.error(`Pricing upload failed for ${fileType}:`, error);
    const errorMessage = error.message || "An unknown error occurred.";
    await db
      .update(pricingUploads)
      .set({ status: "failed", notes: errorMessage })
      .where(eq(pricingUploads.id, uploadRecord.id));

    return { success: false, message: errorMessage };
  }
}
