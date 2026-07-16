import { NextResponse } from "next/server";
import {
  cleanerAuthErrorStatus,
  getCleanerAuth,
} from "@/lib/cleaner-auth";
import {
  getCleanerOnTimeStreak,
  getLeaderboard,
} from "@/lib/queries/leaderboard";

export async function GET() {
  const { cleanerId, error } = await getCleanerAuth();
  if (!cleanerId) {
    return NextResponse.json(
      { error: error ?? "Unauthorized" },
      { status: cleanerAuthErrorStatus(error) }
    );
  }

  try {
    const [leaderboard, streak] = await Promise.all([
      getLeaderboard(25),
      getCleanerOnTimeStreak(cleanerId),
    ]);

    const me = leaderboard.find((r) => r.cleanerId === cleanerId) ?? null;

    return NextResponse.json({
      leaderboard,
      me: me ? { ...me, streak } : { cleanerId, streak, rank: null },
    });
  } catch (err) {
    console.error("[GET /api/cleaner/leaderboard]", err);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 }
    );
  }
}
