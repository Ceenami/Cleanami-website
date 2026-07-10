import { schema } from "@/db";
import { jobs, cancelledJobs, jobsToCleaners } from "@/db/schemas";
import { and, eq, isNotNull } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as webcal from "node-ical";
import { VEvent } from "node-ical";

type DrizzleDb = NodePgDatabase<typeof schema>;

type SyncInput = {
  subscriptionId?: string;
  propertyId?: string;
};

type SyncContext = {
  subscriptionId: string;
  propertyId: string;
  iCalUrl: string;
};

type CancellationResult = {
  success: boolean;
  message: string;
  totalProcessed: number;
  totalCancelled: number;
  cancelledJobIds: string[];
  errors?: Array<{ jobId: string; error: string }>;
};

type ExistingJob = {
  id: string;
  subscriptionId: string | null;
  propertyId: string | null;
  calendarEventUid: string;
  checkInTime: Date | null;
  checkOutTime: Date | null;
  status: "unassigned" | "assigned" | "in-progress" | "completed" | "canceled" | null;
  expectedHours: string | null;
  addonsSnapshot: any;
  paymentIntentId: string | null;
  paymentStatus: "pending" | "authorized" | "captured" | "failed" | "capture_failed" | null;
  paymentFailed: boolean | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const BATCH_SIZE = 100;

export class CancellationDetectionService {
  private db: DrizzleDb;

  constructor(db: DrizzleDb) {
    this.db = db;
  }

  public async detectCancellations(args: SyncInput): Promise<CancellationResult> {
    console.log(`Starting cancellation detection with args:`, args);

    const contextResult = await this._getContext(args);
    if (!contextResult.success || !contextResult.data) {
      return { 
        success: false, 
        message: contextResult.message || "Failed to get context",
        totalProcessed: 0,
        totalCancelled: 0,
        cancelledJobIds: []
      };
    }

    const { subscriptionId, iCalUrl } = contextResult.data;

    const events = await this._fetchAndParseCalendar(iCalUrl);
    if (!events) {
      return { 
        success: false, 
        message: "Failed to fetch or parse calendar.",
        totalProcessed: 0,
        totalCancelled: 0,
        cancelledJobIds: []
      };
    }

    console.log(`Found ${events.length} events in current calendar.`);

    const existingJobs = await this._getExistingJobs(subscriptionId);
    console.log(`Found ${existingJobs.length} existing jobs to check.`);

    if (existingJobs.length === 0) {
      return {
        success: true,
        message: "No existing jobs to check for cancellations.",
        totalProcessed: 0,
        totalCancelled: 0,
        cancelledJobIds: []
      };
    }

    const cancelledJobs = this._findCancelledJobs(existingJobs, events);
    console.log(`Found ${cancelledJobs.length} cancelled jobs.`);

    if (cancelledJobs.length === 0) {
      return {
        success: true,
        message: "No cancelled jobs detected.",
        totalProcessed: existingJobs.length,
        totalCancelled: 0,
        cancelledJobIds: []
      };
    }

    const result = await this._processCancellationsInBatches(cancelledJobs);

    console.log(`Cancellation detection complete. Processed ${result.totalCancelled} cancellations.`);
    
    return {
      success: true,
      message: `Successfully processed ${result.totalCancelled} cancelled jobs.`,
      totalProcessed: existingJobs.length,
      totalCancelled: result.totalCancelled,
      cancelledJobIds: result.cancelledJobIds,
      errors: result.errors
    };
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

  private async _getExistingJobs(subscriptionId: string): Promise<ExistingJob[]> {
    try {
      const jobs = await this.db.query.jobs.findMany({
        where: and(
          eq(schema.jobs.subscriptionId, subscriptionId),
          isNotNull(schema.jobs.calendarEventUid)
        ),
      });

      return jobs as ExistingJob[];
    } catch (error) {
      console.error("Error fetching existing jobs:", error);
      return [];
    }
  }

  private _findCancelledJobs(existingJobs: ExistingJob[], calendarEvents: VEvent[]): ExistingJob[] {
    const currentCalendarUIDs = new Set(
      calendarEvents
        .map(event => event.uid)
        .filter(uid => uid)
    );

    console.log(`Current calendar has ${currentCalendarUIDs.size} valid event UIDs.`);

    const cancelledJobs = existingJobs.filter(job => {
      if (!job.calendarEventUid) {
        return false;
      }
      
      return !currentCalendarUIDs.has(job.calendarEventUid);
    });

    if (cancelledJobs.length > 0) {
      console.log('Cancelled job UIDs:', cancelledJobs.map(job => ({
        jobId: job.id,
        uid: job.calendarEventUid,
        checkOutTime: job.checkOutTime
      })));
    }

    return cancelledJobs;
  }

  private async _processCancellationsInBatches(
    cancelledJobsToProcess: ExistingJob[]
  ): Promise<{
    totalCancelled: number;
    cancelledJobIds: string[];
    errors: Array<{ jobId: string; error: string }>;
  }> {
    let totalCancelled = 0;
    const cancelledJobIds: string[] = [];
    const errors: Array<{ jobId: string; error: string }> = [];

    for (let i = 0; i < cancelledJobsToProcess.length; i += BATCH_SIZE) {
      const batch = cancelledJobsToProcess.slice(i, i + BATCH_SIZE);
      console.log(`Processing cancellation batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

      for (const job of batch) {
        try {
          await this._processSingleCancellation(job);
          totalCancelled++;
          cancelledJobIds.push(job.id);
          console.log(`✓ Cancelled job ${job.id} (UID: ${job.calendarEventUid})`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          errors.push({
            jobId: job.id,
            error: errorMessage
          });
          console.error(`✗ Failed to cancel job ${job.id}:`, errorMessage);
        }
      }
    }

    return {
      totalCancelled,
      cancelledJobIds,
      errors
    };
  }

  private async _processSingleCancellation(job: ExistingJob): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(jobsToCleaners).where(eq(jobsToCleaners.jobId, job.id));

      await tx.insert(cancelledJobs).values({
        originalJobId: job.id,
        subscriptionId: job.subscriptionId!,
        propertyId: job.propertyId!,
        calendarEventUid: job.calendarEventUid,
        checkInTime: job.checkInTime!,
        checkOutTime: job.checkOutTime!,
        status: job.status || 'unassigned',
        expectedHours: job.expectedHours,
        addonsSnapshot: job.addonsSnapshot,
        paymentIntentId: job.paymentIntentId,
        paymentStatus: job.paymentStatus,
        paymentFailed: job.paymentFailed,
        notes: job.notes,
        originalCreatedAt: job.createdAt,
        originalUpdatedAt: job.updatedAt,
        cancelledAt: new Date(),
        cancellationSource: 'auto_detected',
        cancellationReason: 'Calendar event no longer exists'
      });

      await tx.delete(jobs).where(eq(jobs.id, job.id));
    });
  }

  public async detectCancellationsForAllSubscriptions(): Promise<{
    success: boolean;
    message: string;
    totalSubscriptions: number;
    totalJobsProcessed: number;
    totalJobsCancelled: number;
    subscriptionResults: Array<{
      subscriptionId: string;
      processed: number;
      cancelled: number;
      errors: number;
    }>;
    errors: Array<{ subscriptionId: string; error: string }>;
  }> {
    console.log('Starting cancellation detection for all active subscriptions...');

    try {
      const activeSubscriptions = await this.db.query.subscriptions.findMany({
        where: eq(schema.subscriptions.status, 'active'),
        with: {
          property: true,
        },
      });

      console.log(`Found ${activeSubscriptions.length} active subscriptions to check.`);

      const results = {
        totalSubscriptions: activeSubscriptions.length,
        totalJobsProcessed: 0,
        totalJobsCancelled: 0,
        subscriptionResults: [] as Array<{
          subscriptionId: string;
          processed: number;
          cancelled: number;
          errors: number;
        }>,
        errors: [] as Array<{ subscriptionId: string; error: string }>
      };

      for (const subscription of activeSubscriptions) {
        try {
          if (!subscription.property?.iCalUrl) {
            console.log(`Skipping subscription ${subscription.id} - no iCal URL`);
            results.subscriptionResults.push({
              subscriptionId: subscription.id,
              processed: 0,
              cancelled: 0,
              errors: 1
            });
            results.errors.push({
              subscriptionId: subscription.id,
              error: 'No iCal URL found'
            });
            continue;
          }

          console.log(`Checking cancellations for subscription ${subscription.id}...`);
          
          const result = await this.detectCancellations({ 
            subscriptionId: subscription.id 
          });

          results.subscriptionResults.push({
            subscriptionId: subscription.id,
            processed: result.totalProcessed,
            cancelled: result.totalCancelled,
            errors: result.errors?.length || 0
          });

          results.totalJobsProcessed += result.totalProcessed;
          results.totalJobsCancelled += result.totalCancelled;

          if (!result.success) {
            results.errors.push({
              subscriptionId: subscription.id,
              error: result.message
            });
          }

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          results.errors.push({
            subscriptionId: subscription.id,
            error: errorMessage
          });
          console.error(`Error processing subscription ${subscription.id}:`, error);
        }
      }

      console.log('Bulk cancellation detection completed:', {
        totalSubscriptions: results.totalSubscriptions,
        totalJobsProcessed: results.totalJobsProcessed,
        totalJobsCancelled: results.totalJobsCancelled,
        totalErrors: results.errors.length
      });

      return {
        success: true,
        message: `Processed ${results.totalJobsProcessed} jobs across ${results.totalSubscriptions} subscriptions. Cancelled ${results.totalJobsCancelled} jobs.`,
        ...results
      };

    } catch (error) {
      console.error('Fatal error in bulk cancellation detection:', error);
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error',
        totalSubscriptions: 0,
        totalJobsProcessed: 0,
        totalJobsCancelled: 0,
        subscriptionResults: [],
        errors: []
      };
    }
  }
}