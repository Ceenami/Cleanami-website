import { schema } from "@/db";
import { jobs } from "@/db/schemas";
import { and, eq } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as webcal from "node-ical";
import { VEvent } from "node-ical";
import { fromZonedTime } from "date-fns-tz";
import { differenceInDays, startOfDay } from "date-fns";
import { calculateJobStaffing } from "@/lib/pricing/staffing-logic";

type NewJob = typeof jobs.$inferInsert;
type DrizzleDb = NodePgDatabase<typeof schema>;

const IANA_TIMEZONE = "America/New_York";
const DEFAULT_CHECKIN_TIME = "T16:00:00"; // 4:00 PM
const DEFAULT_CHECKOUT_TIME = "T09:00:00"; // 9:00 AM
const BATCH_SIZE = 100;

const isDateOnly = (event: VEvent): boolean => {
  return event.datetype === "date";
};

const createFloridaDate = (date: Date, timeStr: string): Date => {
  const offsetHours = date.getUTCHours();
  let normalizedDate = date;
  // Adjust for potential timezone offsets in date-only events
  if (offsetHours > 0 && offsetHours <= 14) {
    normalizedDate = new Date(date.getTime() - offsetHours * 60 * 60 * 1000);
  }

  const year = normalizedDate.getUTCFullYear();
  const month = normalizedDate.getUTCMonth() + 1;
  const day = normalizedDate.getUTCDate();

  const dateOnlyStr = `${year}-${String(month).padStart(2, "0")}-${String(
    day
  ).padStart(2, "0")}`;

  const localTimeStr = `${dateOnlyStr}${timeStr}`;
  const utcDate = fromZonedTime(localTimeStr, IANA_TIMEZONE);

  return utcDate;
};

type SyncInput = {
  subscriptionId?: string;
  propertyId?: string;
};

type SyncContext = {
  subscriptionId: string;
  propertyId: string;
  iCalUrl: string;
  subscriptionStartDate: Date;
};

type PropertyDetails = {
  bedCount: number;
  bathCount: string;
  sqFt: number | null;
  laundryType: string; // 'in_unit' | 'off_site'
  laundryLoads: number | null;
  hotTubServiceLevel: boolean;
  hotTubDrainCadence: string | null;
};

type CalculatedJobDetails = ReturnType<typeof calculateJobStaffing>;

export class ICalService {
  private db: DrizzleDb;

  constructor(db: DrizzleDb) {
    this.db = db;
  }

  public async syncCalendar(args: SyncInput) {
    console.log(`Starting calendar sync with args:`, args);

    const contextResult = await this._getContext(args);
    if (!contextResult.success || !contextResult.data) {
      return { success: false, message: contextResult.message };
    }

    const { subscriptionId, propertyId, iCalUrl, subscriptionStartDate } =
      contextResult.data;

    const events = await this._fetchAndParseCalendar(iCalUrl);
    if (!events) {
      return { success: false, message: "Failed to fetch or parse calendar." };
    }

    console.log(`Found ${events.length} events in the calendar.`);
    if (events.length === 0) {
      return {
        success: true,
        message: "Calendar is empty, nothing to sync.",
        totalSynced: 0,
      };
    }

    const property = await this.db.query.properties.findFirst({
      where: eq(schema.properties.id, propertyId),
    });

    if (!property) {
      return { success: false, message: "Property not found." };
    }

    const result = await this._processAndSaveEventsInBatches(
      events,
      {
        subscriptionId,
        propertyId,
        subscriptionStartDate,
      },
      property
    );

    console.log(`Sync complete. Total jobs synced: ${result.totalSynced}`);
    return { success: true, ...result };
  }

  private async _getContext(
    args: SyncInput
  ): Promise<{ success: boolean; data?: SyncContext; message?: string }> {
    const { subscriptionId, propertyId } = args;

    if (subscriptionId) {
      const subscription = await this.db.query.subscriptions.findFirst({
        where: eq(schema.subscriptions.id, subscriptionId),
        with: { property: true },
      });
      if (!subscription)
        return { success: false, message: "Subscription not found." };
      if (!subscription.property?.iCalUrl)
        return {
          success: false,
          message: "No iCal URL found for the subscription's property.",
        };

      return {
        success: true,
        data: {
          subscriptionId: subscription.id,
          propertyId: subscription.propertyId,
          iCalUrl: subscription.property.iCalUrl,
          subscriptionStartDate: new Date(subscription.startDate),
        },
      };
    }

    if (propertyId) {
      const property = await this.db.query.properties.findFirst({
        where: eq(schema.properties.id, propertyId),
      });
      if (!property) return { success: false, message: "Property not found." };
      if (!property.iCalUrl)
        return {
          success: false,
          message: "No iCal URL found for this property.",
        };

      const activeSubscription = await this.db.query.subscriptions.findFirst({
        where: and(
          eq(schema.subscriptions.propertyId, propertyId),
          eq(schema.subscriptions.status, "active")
        ),
      });

      if (!activeSubscription)
        return {
          success: false,
          message: "No active subscription found for this property.",
        };

      return {
        success: true,
        data: {
          subscriptionId: activeSubscription.id,
          propertyId: property.id,
          iCalUrl: property.iCalUrl,
          subscriptionStartDate: new Date(activeSubscription.startDate),
        },
      };
    }

    return {
      success: false,
      message: "Either subscriptionId or propertyId must be provided.",
    };
  }

  private async _fetchAndParseCalendar(url: string): Promise<VEvent[] | null> {
    try {
      const icsData = await fetch(url).then((res) => res.text());
      const calendarData = await webcal.async.parseICS(icsData);
      return Object.values(calendarData).filter(
        (e) => e.type === "VEVENT"
      ) as VEvent[];
    } catch (error) {
      console.error("Error fetching or parsing calendar:", error);
      return null;
    }
  }

  private _isHotTubDeepCleanDue(
    jobDate: Date,
    startDate: Date,
    cadence: string | null
  ): boolean {
    if (!cadence) return false;

    const start = startOfDay(startDate);
    const job = startOfDay(jobDate);
    const diffDays = Math.abs(differenceInDays(job, start));

    let cadenceDays = 0;

    switch (cadence) {
      case "4_weeks":
        cadenceDays = 28;
        break;
      case "6_weeks":
        cadenceDays = 42;
        break;
      case "2_months":
        cadenceDays = 56;
        break;
      case "3_months":
        cadenceDays = 84;
        break;
      case "4_months":
        cadenceDays = 112;
        break;
      default:
        console.warn(`Unknown hot tub cadence: ${cadence}`);
        return false;
    }

    if (cadenceDays === 0) return false;

    return diffDays > 0 && diffDays % cadenceDays < 7;
  }

  private _calculateJobDetails(
    property: PropertyDetails,
    jobDate: Date,
    subscriptionStartDate: Date
  ): CalculatedJobDetails {
    const isDeepClean = property.hotTubServiceLevel
      ? this._isHotTubDeepCleanDue(
          jobDate,
          subscriptionStartDate,
          property.hotTubDrainCadence
        )
      : false;

    return calculateJobStaffing({
      bedCount: property.bedCount,
      bathCount: property.bathCount,
      sqFt: property.sqFt,
      laundryType: property.laundryType,
      hotTubServiceLevel: property.hotTubServiceLevel,
      hotTubDeepClean: isDeepClean,
    });
  }

  private async _processAndSaveEventsInBatches(
    events: VEvent[],
    context: {
      subscriptionId: string;
      propertyId: string;
      subscriptionStartDate: Date;
    },
    property: PropertyDetails
  ) {
    // Sort events
    const sortedEvents = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    );

    // "Enforce minimum 7-day buffer before first clean."
    const bufferDate = new Date(context.subscriptionStartDate);
    bufferDate.setDate(bufferDate.getDate() + 7);
    bufferDate.setHours(0, 0, 0, 0);

    const filteredEvents = sortedEvents.filter((event) => {
      const eventStartDate = new Date(event.start);
      eventStartDate.setHours(0, 0, 0, 0);
      return eventStartDate.getTime() >= bufferDate.getTime();
    });

    const allJobsToInsert: NewJob[] = filteredEvents.map((event, index) => {
      const isEndDateOnly = isDateOnly(event);

      // Arrival window anchor = guest checkout time
      const jobStartTime: Date = isEndDateOnly
        ? createFloridaDate(event.end, DEFAULT_CHECKOUT_TIME)
        : event.end;

      // Calculate the "Standard" deadline (4PM on the day of checkout)
      const standardDeadline = createFloridaDate(
        event.end,
        DEFAULT_CHECKIN_TIME
      );

      const nextEvent = filteredEvents[index + 1];

      // must-finish-before = next guest check-in time (default 4PM if missing)
      let jobDeadline: Date;

      if (nextEvent) {
        const isNextStartDateOnly = isDateOnly(nextEvent);
        const nextCheckIn = isNextStartDateOnly
          ? createFloridaDate(nextEvent.start, DEFAULT_CHECKIN_TIME)
          : nextEvent.start;

        // Take the earlier of the two times
        jobDeadline =
          nextCheckIn.getTime() < standardDeadline.getTime()
            ? nextCheckIn
            : standardDeadline;
      } else {
        jobDeadline = standardDeadline;
      }

      // Calculate details (hours, team size, deep clean status, expected loads)
      const jobDetails = this._calculateJobDetails(
        property,
        jobStartTime,
        context.subscriptionStartDate
      );

      // "Deduplicate jobs using (UID + end_date)"
      const compositeUid = `${event.uid}_${jobStartTime.toISOString()}`;

      return {
        subscriptionId: context.subscriptionId,
        propertyId: context.propertyId,
        checkInTime: jobStartTime,
        checkOutTime: jobDeadline,
        calendarEventUid: compositeUid,
        status: "unassigned" as const,
        expectedHours: jobDetails.expectedHoursPerCleaner.toString(),
        addonsSnapshot: {
          laundryType: property.laundryType,
          laundryLoads: jobDetails.expectedLaundryLoads,
          hotTubServiceLevel: property.hotTubServiceLevel
            ? jobDetails.isDeepClean
              ? "deep_clean"
              : "basic"
            : "none",
          hotTubDrainCadence: property.hotTubDrainCadence,
          teamSize: jobDetails.teamSize,
          propertySize: jobDetails.propertySize,
          requiresManualStaffing: jobDetails.requiresManualStaffing,
          bedroomBathroomTotal: jobDetails.bedroomBathroomTotal,
          baseCleaningHours: jobDetails.baseCleaningHours,
          offSiteLaundryHours: jobDetails.offSiteLaundryHours,
          hotTubHours: jobDetails.hotTubHours,
        },
      };
    });

    let totalSynced = 0;

    for (let i = 0; i < allJobsToInsert.length; i += BATCH_SIZE) {
      const batch = allJobsToInsert.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

      try {
        const result = await this.db
          .insert(jobs)
          .values(batch)
          .onConflictDoUpdate({
            target: jobs.calendarEventUid,
            set: {
              checkInTime: jobs.checkInTime,
              checkOutTime: jobs.checkOutTime,
              expectedHours: jobs.expectedHours,
              addonsSnapshot: jobs.addonsSnapshot,
            },
          })
          .returning({ id: jobs.id });

        totalSynced += result.length;
      } catch (error) {
        console.error(`Error processing batch starting at index ${i}:`, error);
      }
    }

    return {
      message: `Successfully synced ${totalSynced} of ${allJobsToInsert.length} total events.`,
      totalSynced,
    };
  }
}