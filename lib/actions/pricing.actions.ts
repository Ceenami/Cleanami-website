"use server";

import { createClient } from "@/lib/supabase/server";
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

export async function handleFileUpload(
  formData: FormData,
  fileType: PricingFileType
): Promise<{
  success: boolean;
  message: string;
}> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, message: "Unauthorized: You must be logged in." };
  }

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
    const parsedCsv = Papa.parse(fileContent, {
      header: true,
      skipEmptyLines: true,
    });

    if (parsedCsv.errors.length > 0) {
      throw new Error(`CSV Parsing Error: ${parsedCsv.errors[0].message}`);
    }

    await db.transaction(async (tx) => {
      // Logic for updating the database based on fileType
      // (This is the same as the previous version)
      switch (fileType) {
        case "base_prices":
          await tx.delete(basePricingRules);
          const basePricesData = parsedCsv.data.map((row: any) => ({
            bedrooms: parseInt(row.Bedrooms),
            price1BathCents: Math.round(parseFloat(row["1_Bath"]) * 100),
            price2BathCents: Math.round(parseFloat(row["2_Bath"]) * 100),
            price3BathCents: Math.round(parseFloat(row["3_Bath"]) * 100),
            price4BathCents: Math.round(parseFloat(row["4_Bath"]) * 100),
            price5BathCents: Math.round(parseFloat(row["5_Bath"]) * 100),
          }));
          await tx.insert(basePricingRules).values(basePricesData);
          break;
        case "sqft_surcharges":
          await tx.delete(sqftSurchargeRules);
          const sqftData = parsedCsv.data.map((row: any) => ({
            rangeStart: parseInt(row.Range_Start),
            rangeEnd: parseInt(row.Range_End),
            surchargeCents:
              row.Surcharge_Amount.toLowerCase() === "custom quote"
                ? 0
                : Math.round(parseFloat(row.Surcharge_Amount) * 100),
            isCustomQuote:
              row.Surcharge_Amount.toLowerCase() === "custom quote",
          }));
          await tx.insert(sqftSurchargeRules).values(sqftData);
          break;
        case "laundry_pricing":
          await tx.delete(laundryPricingRules);
          const laundryData = parsedCsv.data.map((row: any) => ({
            serviceType: row.Service_Type,
            customerRevenueBaseCents: Math.round(
              parseFloat(row.Customer_Revenue_Base) * 100
            ),
            customerRevenuePerLoadCents: Math.round(
              parseFloat(row.Customer_Revenue_Per_Load) * 100
            ),
            cleanerBonusPerLoadCents: Math.round(
              parseFloat(row.Cleaner_Bonus_Per_Load) * 100
            ),
          }));
          await tx.insert(laundryPricingRules).values(laundryData);
          break;
        case "hot_tub_pricing":
          await tx.delete(hotTubPricingRules);
          const hotTubData = parsedCsv.data.map((row: any) => ({
            serviceType: row.Service_Type,
            customerRevenueCents: Math.round(
              parseFloat(row.Customer_Revenue) * 100
            ),
            timeAddHours: row.Time_Add_Hours, // This keeps it as a string
          }));
          await tx.insert(hotTubPricingRules).values(hotTubData);
          break;
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
