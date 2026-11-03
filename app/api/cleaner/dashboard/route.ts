import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  cleaners,
  payouts,
  jobStats,
  reliabilityEvents,
  cleanerBadges,
  badges,
} from "@/db/schemas";
import { eq, sql, desc } from "drizzle-orm";
import { getCleanerAuth, cleanerAuthErrorStatus } from "@/lib/cleaner-auth";

/** Own aggregate statistics only. No Stripe synchronization or device-side policy. */
export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId)
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) },
    );
  try {
    const cleaner = await db.query.cleaners.findFirst({
      where: eq(cleaners.id, cleanerId),
      columns: { reliabilityScore: true },
    });
    const [stats] = await db
      .select({
        completed: sql<number>`count(*) filter (where ${jobStats.completedAt} is not null)::int`,
        rating: sql<number>`coalesce(avg(${jobStats.rating}),0)::float`,
      })
      .from(jobStats)
      .where(eq(jobStats.cleanerId, cleanerId));
    const [timeliness] = await db
      .select({
        total: sql<number>`count(*)::int`,
        positive: sql<number>`count(*) filter (where ${reliabilityEvents.eventType} in ('on_time','early_arrival'))::int`,
      })
      .from(reliabilityEvents)
      .where(eq(reliabilityEvents.cleanerId, cleanerId));
    const [earnings] = await db
      .select({
        total: sql<string>`coalesce(sum(${payouts.amount}) filter (where ${payouts.status} = 'released'),0)`,
      })
      .from(payouts)
      .where(eq(payouts.cleanerId, cleanerId));
    const recent = await db
      .select({
        amount: payouts.amount,
        status: payouts.status,
        date: payouts.createdAt,
      })
      .from(payouts)
      .where(eq(payouts.cleanerId, cleanerId))
      .orderBy(desc(payouts.createdAt))
      .limit(20);
    const ownBadges = await db
      .select({
        name: badges.name,
        icon: badges.icon,
        category: badges.category,
        description: badges.description,
        earnedAt: cleanerBadges.earnedAt,
      })
      .from(cleanerBadges)
      .innerJoin(badges, eq(badges.id, cleanerBadges.badgeId))
      .where(eq(cleanerBadges.cleanerId, cleanerId));
    return NextResponse.json({
      cleanerId,
      stats: {
        jobsCompleted: stats.completed,
        averageRating: Math.round(Number(stats.rating) * 10) / 10,
        onTimeRate: timeliness.total
          ? Math.round((timeliness.positive / timeliness.total) * 100)
          : 100,
        totalEarnings: Number(earnings.total),
        reliabilityScore: Number(cleaner?.reliabilityScore ?? 0),
        badgesCount: ownBadges.length,
      },
      payouts: recent.map((p) => ({
        amount: Number(p.amount),
        status: p.status === "released" ? "paid" : p.status,
        date: p.date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "America/New_York",
        }),
      })),
      badges: ownBadges,
    });
  } catch (e) {
    console.error("[cleaner dashboard]", e);
    return NextResponse.json(
      { error: "Dashboard unavailable" },
      { status: 500 },
    );
  }
}
