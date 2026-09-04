import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { fromZonedTime } from "date-fns-tz";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { jobs, properties } from "@/db/schemas";
import { getJobsWithDetails } from "@/lib/queries/jobs";
import {
  getDashboardJobDateRange,
} from "@/lib/queries/dashboard-job-window";
import {
  customerAuthErrorStatus,
  resolvePortalCustomerScope,
} from "@/lib/customer-auth";
import { getAdminAuth } from "@/lib/admin-auth";
import { buildJobStaffingUpdate } from "@/lib/pricing/apply-job-staffing";
import { loadHotTubTimeAdditions } from "@/lib/pricing/hot-tub-time";
import {
  getArrivalInstant,
  getDeadlineInstant,
} from "@/lib/scheduling/residential-notice";
import { getStartOfTodayEastern } from "@/lib/time/eastern";
import { appendJobNote } from "@/lib/jobs/job-notes";
import {
  JOB_LABELS,
  JOB_LABEL_VALUES,
  isJobLabel,
} from "@/lib/constants/service-type";

const EASTERN_TZ = "America/New_York";

export async function GET(request: NextRequest) {
  try {
    const scope = await resolvePortalCustomerScope(request);
    if (scope.error) {
      return NextResponse.json(
        { error: scope.error, data: [], nextPage: null },
        { status: customerAuthErrorStatus(scope.error) }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const isDashboard = searchParams.get("dashboard") === "1";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(
      searchParams.get("limit") || (isDashboard ? "20" : "10")
    );
    const status = (searchParams.get("status") || "all") as
      | "unassigned"
      | "assigned"
      | "in-progress"
      | "completed"
      | "canceled"
      | "all";
    const query = searchParams.get("query") || "";

    // Counterproposal item 12. Validated against the two literals rather than
    // cast, so an arbitrary string from the query string can never reach the
    // where-clause — an unknown value falls back to "all" and shows everything,
    // which is the safe direction for an admin list.
    const rawServiceType = searchParams.get("serviceType");
    const serviceType =
      rawServiceType === "vacation_rental_subscription" ||
      rawServiceType === "residential_one_time"
        ? rawServiceType
        : "all";

    // The dashboard board always wants the next clean first. The portal job
    // list wants that too when it is showing what is coming, and the opposite
    // when it is showing what has already happened - a customer looking at past
    // cleans wants the most recent one at the top, not their first ever.
    //
    // Validated against the two literals, never cast: an unknown value falls
    // back to the previous behaviour rather than reaching the order-by.
    const rawSort = searchParams.get("sortByCheckIn");
    const sortByCheckIn =
      rawSort === "asc" || rawSort === "desc"
        ? rawSort
        : isDashboard
          ? "asc"
          : undefined;

    let startDate = searchParams.get("startDate")
      ? new Date(searchParams.get("startDate")!)
      : undefined;
    let endDate = searchParams.get("endDate")
      ? new Date(searchParams.get("endDate")!)
      : undefined;

    if (isDashboard && !startDate && !endDate) {
      const range = getDashboardJobDateRange();
      startDate = range.startDate;
      endDate = range.endDate;
    }

    const result = await getJobsWithDetails({
      page,
      limit,
      status,
      query,
      startDate,
      endDate,
      customerId: scope.customerId,
      serviceType,
      sortByCheckIn,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching jobs:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}


/**
 * Create a job by hand.
 *
 * Until now nothing could. Every job in the system came from the iCal sync,
 * from onboarding's first clean, or from a customer booking one — an admin had
 * no path of their own, so a clean that needed redoing could only be faked by
 * editing something else.
 *
 * **This creates. It does not assign.** Assignment goes through the endpoints
 * every other job already uses: `GET /api/jobs/[id]/available-cleaners` to
 * grade the pool, `POST /api/jobs/[id]/reassign` to commit. That is not
 * squeamishness about scope — the one-job-per-cleaner-per-day rule, its 409,
 * the Super Admin override and the typed reason all live in the reassign
 * route, and a create-that-also-assigns would need a second call site for the
 * same predicate. A second same-day predicate is a bug waiting for the Eastern
 * day boundary to move under one copy and not the other. Creating only means a
 * manual job inherits the rule and the override for no new logic at all.
 *
 * No money. No PaymentIntent, no `payment_status`, no confirmation email —
 * there is no booking here and the customer already paid for the clean that
 * needed redoing. On completion the cleaner is still paid: a job with no
 * PaymentIntent takes the no-charge branch of `runCaptureAndPayout`, which
 * writes payouts and deliberately writes no reserve row, because there is no
 * revenue to reserve against.
 */
export async function POST(request: NextRequest) {
  const { isAdmin, error: authError } = await getAdminAuth(request);
  if (!isAdmin) {
    return NextResponse.json(
      { error: authError ?? "Unauthorized" },
      { status: 401 }
    );
  }

  let body: {
    propertyId?: unknown;
    date?: unknown;
    arrivalWindow?: unknown;
    jobLabel?: unknown;
    notes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const propertyId = typeof body.propertyId === "string" ? body.propertyId.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const arrivalWindow =
    typeof body.arrivalWindow === "string" ? body.arrivalWindow.trim() : "";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  if (!propertyId) {
    return NextResponse.json({ error: "A property is required." }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "A date is required, as YYYY-MM-DD." },
      { status: 400 }
    );
  }

  // Checked here as well as by the column's CHECK. The CHECK is the backstop
  // that keeps bad data out of the table; this is what turns a typo into a
  // sentence the admin can act on instead of a 500 from Postgres.
  const jobLabel =
    body.jobLabel === undefined || body.jobLabel === null || body.jobLabel === ""
      ? null
      : body.jobLabel;
  if (jobLabel !== null && !isJobLabel(jobLabel)) {
    return NextResponse.json(
      {
        error: `A job label must be one of: ${JOB_LABEL_VALUES.join(", ")}.`,
        code: "invalid_job_label",
      },
      { status: 400 }
    );
  }

  const property = await db.query.properties.findFirst({
    where: eq(properties.id, propertyId),
  });
  if (!property) {
    return NextResponse.json({ error: "Property not found." }, { status: 404 });
  }

  // From the property, never from the request. What kind of clean this is is
  // a fact about the home; a reclean of a rental turnover is still a rental
  // job, and letting an admin type it here is how the two columns drift.
  const isResidential = property.serviceType === "residential_one_time";

  let arrival: Date;
  let rentalDeadline: Date | null = null;

  if (isResidential) {
    if (!arrivalWindow) {
      return NextResponse.json(
        { error: "Choose an arrival window for a residential clean." },
        { status: 400 }
      );
    }
    // Returns null rather than an Invalid Date. That matters: `Invalid Date <
    // x` is false, so a bad value would sail past every comparison below and
    // only be caught by Postgres at the insert.
    const instant = getArrivalInstant(date, arrivalWindow);
    if (!instant) {
      return NextResponse.json(
        { error: "That is not an arrival window we offer." },
        { status: 400 }
      );
    }
    arrival = instant;
  } else {
    const checkOutTime = property.defaultCheckOutTime ?? "09:00:00";
    const checkInTime = property.defaultCheckInTime ?? "16:00:00";
    arrival = fromZonedTime(`${date}T${checkOutTime}`, EASTERN_TZ);
    rentalDeadline = fromZonedTime(`${date}T${checkInTime}`, EASTERN_TZ);

    if (Number.isNaN(arrival.getTime()) || Number.isNaN(rentalDeadline.getTime())) {
      return NextResponse.json(
        {
          error:
            "This property's check-in/check-out times are misconfigured, so a clean cannot be scheduled for it.",
        },
        { status: 400 }
      );
    }
  }

  // The customer-facing notice rules do NOT apply here, and that is the point.
  // 48 hours' residential notice and the two-day one-off buffer are promises
  // made to a customer at the point of sale; this is the office fixing
  // something that has already gone wrong, and a fallback that cannot schedule
  // a clean for tomorrow is not a fallback. The past is still refused, because
  // a job behind the current date cannot be worked and would sit unassignable.
  if (arrival < getStartOfTodayEastern()) {
    return NextResponse.json(
      { error: "Choose today or a later date." },
      { status: 400 }
    );
  }

  let staffing;
  try {
    const hotTubTimeAdditions = await loadHotTubTimeAdditions();
    staffing = buildJobStaffingUpdate({
      property: {
        bedCount: property.bedCount,
        bathCount: property.bathCount,
        sqFt: property.sqFt,
        laundryType: property.laundryType,
        hotTubServiceLevel: property.hotTubServiceLevel,
        hotTubDrainCadence: property.hotTubDrainCadence,
        petsAllowed: property.petsAllowed,
      },
      checkInTime: arrival,
      subscriptionStart: arrival,
      hotTubTimeAdditions,
    });
  } catch (err) {
    console.error("[POST /api/jobs] staffing calculation failed", err);
    return NextResponse.json(
      { error: "Could not work out the staffing for this property." },
      { status: 500 }
    );
  }

  // Residential: the deadline is the window's END plus the expected hours, not
  // the window's end. Needs the staffing result, so it is computed here rather
  // than beside the arrival instant above.
  const deadline = isResidential
    ? getDeadlineInstant(date, arrivalWindow, staffing.staffing.expectedHoursPerCleaner)
    : rentalDeadline;

  const systemLine = jobLabel
    ? `[System] Manual ${JOB_LABELS[jobLabel]} created by admin.`
    : "[System] Manual clean created by admin.";

  try {
    const [created] = await db
      .insert(jobs)
      .values({
        subscriptionId: null,
        propertyId: property.id,
        checkInTime: arrival,
        checkOutTime: deadline,
        // Synthetic, unique, and deliberately not iCal-shaped: the sync keys
        // off the UIDs a feed gives it, and a manual job must never look like
        // an event that has since disappeared from a calendar.
        calendarEventUid: `rec_${randomUUID()}`,
        status: "unassigned",
        serviceType: property.serviceType,
        jobSource: "manual",
        jobLabel,
        expectedHours: staffing.expectedHours,
        addonsSnapshot: isResidential
          ? { ...staffing.addonsSnapshot, arrivalWindow }
          : staffing.addonsSnapshot,
        // The admin's reason goes under the system line rather than over it.
        // "Tied to the customer/property in notes or job details" is the whole
        // of the link back to the original clean — there is no reclean_of
        // column and there is deliberately not going to be one this phase.
        notes: notes ? appendJobNote(systemLine, notes) : systemLine,
      })
      .returning({ id: jobs.id });

    if (!created) throw new Error("jobs insert returned no rows");

    return NextResponse.json(
      {
        success: true,
        jobId: created.id,
        // The customer is reached through the property, which is why no
        // customer id was added to jobs.
        customerId: property.customerId,
        serviceType: property.serviceType,
        jobLabel,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[POST /api/jobs] insert failed", err);
    return NextResponse.json(
      { error: "Could not create the job." },
      { status: 500 }
    );
  }
}

export type GetJobsResponse = Awaited<ReturnType<typeof getJobsWithDetails>>;
