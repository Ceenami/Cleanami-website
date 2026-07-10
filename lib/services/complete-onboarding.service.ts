import "server-only";

import { getDbOrNull } from "@/db";
import { createAdminClient } from "@/lib/supabase/server";
import {
  customers,
  properties,
  subscriptions,
  checklistFiles,
  jobs,
} from "@/db/schema";
import { SignupFormData, signupFormSchema } from "@/lib/validations/bookng-modal";
import { ICalService } from "@/lib/services/iCal/ical.service";
import { eq } from "drizzle-orm";
import { getStripe } from "@/lib/stripe/get-stripe";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";
import { inviteCustomerToPortalAfterPayment } from "@/lib/services/auth/customer-account.service";

export type CompleteOnboardingResult =
  | {
      success: true;
      data: {
        customer: { id: string };
        property: { id: string };
        subscription: { id: string };
        fileUploadResults: Array<{
          fileName: string;
          success: boolean;
          error?: string;
        }>;
        portalInviteEmailSent: boolean;
        alreadyCompleted?: boolean;
      };
    }
  | { success: false; error: string };

async function geocodeAddress(
  address: string
): Promise<{ latitude: string; longitude: string } | null> {
  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!googleMapsApiKey) {
    console.warn(
      "Geocoding skipped: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not configured"
    );
    return null;
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        address
      )}&key=${googleMapsApiKey}`
    );

    const data = await response.json();

    if (data.status === "OK" && data.results.length > 0) {
      const location = data.results[0].geometry.location;
      return {
        latitude: location.lat.toString(),
        longitude: location.lng.toString(),
      };
    }

    console.warn("Geocoding failed during onboarding:", data.status, address);
    return null;
  } catch (error) {
    console.error("Geocoding error during onboarding:", error);
    return null;
  }
}

async function uploadFileWithRetry(
  supabase: Awaited<ReturnType<typeof createAdminClient>>,
  storagePath: string,
  file: File,
  maxRetries = 3
): Promise<{ success: boolean; error?: { message?: string } }> {
  for (let i = 0; i < maxRetries; i++) {
    const { error } = await supabase.storage
      .from("checklists")
      .upload(storagePath, file);

    if (!error) return { success: true };

    if (i === maxRetries - 1) return { success: false, error };

    await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
  }

  return { success: false, error: { message: "Max retries exceeded" } };
}

export async function completeOnboardingForPayment(
  formData: SignupFormData,
  paymentIntentId: string
): Promise<CompleteOnboardingResult> {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return { success: false, error: SERVICE_UNAVAILABLE.stripe };
    }

    const db = getDbOrNull();
    if (!db) {
      return { success: false, error: SERVICE_UNAVAILABLE.database };
    }

    const existingSubscription = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.firstCleanPaymentId, paymentIntentId),
    });

    if (existingSubscription) {
      const existingCustomer = await db.query.customers.findFirst({
        where: eq(customers.id, existingSubscription.customerId),
      });

      if (!existingCustomer) {
        return {
          success: false,
          error: "Subscription record exists but customer could not be found.",
        };
      }

      const accountResult = await inviteCustomerToPortalAfterPayment({
        email: existingCustomer.email,
        name: existingCustomer.name,
      });

      return {
        success: true,
        data: {
          customer: { id: existingSubscription.customerId },
          property: { id: existingSubscription.propertyId },
          subscription: { id: existingSubscription.id },
          fileUploadResults: [],
          portalInviteEmailSent: accountResult.success
            ? accountResult.emailSent
            : false,
          alreadyCompleted: true,
        },
      };
    }

    const validatedData = signupFormSchema.parse(formData);

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const stripeCustomerId =
      typeof paymentIntent.customer === "string" ? paymentIntent.customer : null;

    if (paymentIntent.status !== "succeeded") {
      return {
        success: false,
        error:
          "Payment has not completed successfully. Customer portal access cannot be granted.",
      };
    }

    if (!stripeCustomerId) {
      return {
        success: false,
        error:
          "Critical: Could not find a Stripe Customer ID associated with this payment.",
      };
    }

    const {
      name,
      email,
      phoneNumber,
      address,
      sqft,
      bedrooms,
      bathrooms,
      hasHotTub,
      laundryService,
      laundryLoads,
      hotTubService,
      hotTubDrain,
      hotTubDrainCadence,
      subscriptionMonths,
      checklistFile,
      useDefaultChecklist,
      iCalUrl,
      firstCleanDate,
    } = validatedData;

    if (checklistFile && checklistFile.length > 0) {
      for (const file of checklistFile) {
        if (file.size > 10 * 1024 * 1024) {
          return {
            success: false,
            error: `File ${file.name} is too large. Maximum size is 10MB.`,
          };
        }
        const allowedTypes = [
          "application/pdf",
          "image/jpeg",
          "image/png",
          "image/jpg",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.oasis.opendocument.spreadsheet",
        ];
        if (!allowedTypes.includes(file.type)) {
          return {
            success: false,
            error: `File ${file.name} has an unsupported format. Please use PDF, JPEG, or PNG files.`,
          };
        }
      }
    }

    const coordinates = await geocodeAddress(address);

    const result = await db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({
          name,
          email,
          phone: phoneNumber,
          stripeCustomerId,
          portalAccessEnabled: true,
        })
        .onConflictDoUpdate({
          target: customers.email,
          set: {
            name,
            phone: phoneNumber,
            stripeCustomerId,
            portalAccessEnabled: true,
            updatedAt: new Date(),
          },
        })
        .returning();

      const propertyValues: Record<string, unknown> = {
        customerId: customer.id,
        address,
        sqFt: sqft,
        bedCount: bedrooms,
        bathCount: String(bathrooms),
        hasHotTub,
        laundryType: laundryService,
        laundryLoads,
        hotTubServiceLevel: hotTubService,
        hotTubDrain,
        hotTubDrainCadence,
        useDefaultChecklist,
        iCalUrl,
        defaultCheckInTime: validatedData.defaultCheckInTime,
        defaultCheckOutTime: validatedData.defaultCheckOutTime,
      };

      if (coordinates) {
        propertyValues.latitude = coordinates.latitude;
        propertyValues.longitude = coordinates.longitude;
        propertyValues.geocodedAt = new Date();
      }

      const [property] = await tx
        .insert(properties)
        .values(propertyValues as typeof properties.$inferInsert)
        .returning();

      const startDate = new Date(firstCleanDate);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + subscriptionMonths);

      const [subscription] = await tx
        .insert(subscriptions)
        .values({
          customerId: customer.id,
          propertyId: property.id,
          stripeSubscriptionId: null,
          durationMonths: subscriptionMonths,
          firstCleanPaymentId: paymentIntentId,
          isFirstCleanPrepaid: true,
          status: "active",
          startDate: firstCleanDate.toISOString().split("T")[0],
          endDate: endDate.toISOString().split("T")[0],
        })
        .returning();

      return { customer, property, subscription };
    });

    const fileUploadResults: Array<{
      fileName: string;
      success: boolean;
      error?: string;
    }> = [];

    if (checklistFile && checklistFile.length > 0) {
      const supabase = await createAdminClient();

      for (const file of checklistFile) {
        try {
          const storagePath = `checklists/${result.property.id}/${file.name}`;
          const uploadResult = await uploadFileWithRetry(
            supabase,
            storagePath,
            file
          );

          if (uploadResult.success) {
            await db.insert(checklistFiles).values({
              propertyId: result.property.id,
              fileName: file.name,
              storagePath,
              fileSize: file.size,
            });
            fileUploadResults.push({ fileName: file.name, success: true });
          } else {
            fileUploadResults.push({
              fileName: file.name,
              success: false,
              error: uploadResult.error?.message || "Unknown upload error",
            });
          }
        } catch (fileError) {
          fileUploadResults.push({
            fileName: file.name,
            success: false,
            error:
              fileError instanceof Error ? fileError.message : "Unknown error",
          });
        }
      }
    }

    if (result.subscription && iCalUrl) {
      try {
        const icalService = new ICalService(db);
        await icalService.syncCalendar({
          subscriptionId: result.subscription.id,
        });

        const firstJob = await db.query.jobs.findFirst({
          where: eq(jobs.subscriptionId, result.subscription.id),
          orderBy: (jobsTable, { asc }) => [
            asc(jobsTable.checkOutTime),
            asc(jobsTable.createdAt),
          ],
        });

        if (firstJob) {
          await db
            .update(jobs)
            .set({
              paymentIntentId,
              paymentStatus: "captured",
            })
            .where(eq(jobs.id, firstJob.id));
        }
      } catch (syncError) {
        console.error(
          `Initial calendar sync failed for subscription ${result.subscription.id}`,
          syncError
        );
      }
    }

    const accountResult = await inviteCustomerToPortalAfterPayment({
      email,
      name,
    });

    if (!accountResult.success) {
      return { success: false, error: accountResult.error };
    }

    return {
      success: true,
      data: {
        customer: { id: result.customer.id },
        property: { id: result.property.id },
        subscription: { id: result.subscription.id },
        fileUploadResults,
        portalInviteEmailSent: accountResult.emailSent,
      },
    };
  } catch (error) {
    console.error("CRITICAL: Onboarding failed after successful payment.", {
      paymentIntentId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to save subscription details. Please contact support.",
    };
  }
}
