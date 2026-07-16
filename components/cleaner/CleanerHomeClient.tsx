"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader, Trophy, Flame, ShieldCheck, Star, Award } from "lucide-react";
import { PushOptIn } from "@/components/cleaner/PushOptIn";

type LeaderboardRow = {
  cleanerId: string;
  fullName: string;
  reliabilityScore: number;
  jobsCompleted: number;
  badgesCount: number;
  earnings: number;
  averageStars: number | null;
  rank: number;
};

type Me = {
  cleanerId: string;
  rank: number | null;
  streak: number;
  reliabilityScore?: number;
  jobsCompleted?: number;
  badgesCount?: number;
  averageStars?: number | null;
};

type Profile = {
  fullName: string;
  reliabilityScore: number;
  badges: { id: string; name: string; icon: string }[];
};

export function CleanerHomeClient() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [me, setMe] = useState<Me | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [lbRes, profileRes] = await Promise.all([
          fetch("/api/cleaner/leaderboard"),
          fetch("/api/cleaner/profile"),
        ]);
        const lb = await lbRes.json();
        const pf = await profileRes.json();
        setLeaderboard(lb.leaderboard ?? []);
        setMe(lb.me ?? null);
        setProfile(pf.profile ?? pf ?? null);
      } catch {
        // leave empty state
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  const reliability = profile?.reliabilityScore ?? me?.reliabilityScore ?? 100;
  const badgeCount = profile?.badges.length ?? me?.badgesCount ?? 0;

  return (
    <div className="mx-auto max-w-lg space-y-6 p-4 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {profile ? `Hi, ${profile.fullName.split(" ")[0]}` : "Welcome"}
        </h1>
        <p className="text-sm text-gray-500">Your CleanNami home</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          icon={<ShieldCheck className="h-5 w-5 text-teal-600" />}
          label="Reliability"
          value={`${Math.round(reliability)}%`}
        />
        <StatCard
          icon={<Flame className="h-5 w-5 text-orange-500" />}
          label="On-time streak"
          value={`${me?.streak ?? 0}`}
        />
        <StatCard
          icon={<Trophy className="h-5 w-5 text-amber-500" />}
          label="Rank"
          value={me?.rank ? `#${me.rank}` : "—"}
        />
        <StatCard
          icon={<Award className="h-5 w-5 text-indigo-500" />}
          label="Badges"
          value={`${badgeCount}`}
        />
      </div>

      {profile && profile.badges.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-gray-700">
            Your badges
          </h2>
          <div className="flex flex-wrap gap-2">
            {profile.badges.map((b) => (
              <span
                key={b.id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm"
                title={b.name}
              >
                <span>{b.icon}</span>
                <span className="text-gray-700">{b.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">Leaderboard</h2>
          <Trophy className="h-4 w-4 text-amber-500" />
        </div>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-gray-400">No rankings yet.</p>
        ) : (
          <ol className="space-y-1">
            {leaderboard.slice(0, 10).map((r) => {
              const isMe = me?.cleanerId === r.cleanerId;
              return (
                <li
                  key={r.cleanerId}
                  className={`flex items-center justify-between rounded px-2 py-1.5 text-sm ${
                    isMe ? "bg-teal-50 font-semibold text-teal-800" : "text-gray-700"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-6 text-gray-400">#{r.rank}</span>
                    <span>{isMe ? "You" : r.fullName}</span>
                  </span>
                  <span className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="inline-flex items-center gap-0.5">
                      <ShieldCheck className="h-3 w-3" />
                      {Math.round(r.reliabilityScore)}%
                    </span>
                    {r.averageStars != null && (
                      <span className="inline-flex items-center gap-0.5">
                        <Star className="h-3 w-3" />
                        {r.averageStars}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <Link
        href="/cleaner/jobs"
        className="block rounded-xl bg-teal-600 px-4 py-3 text-center font-semibold text-white hover:bg-teal-700"
      >
        View my jobs
      </Link>

      <PushOptIn />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2">{icon}</div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}
