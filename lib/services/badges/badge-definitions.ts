export type BadgeRequirement =
  | { type: "reliability_min"; value: number }
  | { type: "hot_tub_cert" }
  | { type: "jobs_completed"; value: number }
  | { type: "avg_rating_min"; value: number; minCount: number }
  | { type: "laundry_jobs"; value: number }
  | { type: "on_call_jobs"; value: number };

export type BadgeCategory =
  | "reliability"
  | "performance"
  | "specialization"
  | "achievement";

export type BadgeDefinition = {
  name: string;
  description: string;
  icon: string;
  category: BadgeCategory;
  pointsValue: number;
  requirements: BadgeRequirement;
};

/** Canonical badge catalog. Seeded into the `badges` table by seed-badges.ts. */
export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    name: "Reliable Pro",
    description: "Reliability score of 95 or higher.",
    icon: "🛡️",
    category: "reliability",
    pointsValue: 50,
    requirements: { type: "reliability_min", value: 95 },
  },
  {
    name: "Hot Tub Certified",
    description: "Certified to service hot tubs.",
    icon: "♨️",
    category: "specialization",
    pointsValue: 30,
    requirements: { type: "hot_tub_cert" },
  },
  {
    name: "On-Call Hero",
    description: "Completed 10 on-call jobs.",
    icon: "🚨",
    category: "performance",
    pointsValue: 40,
    requirements: { type: "on_call_jobs", value: 10 },
  },
  {
    name: "Laundry Lead Pro",
    description: "Completed 20 laundry-lead jobs.",
    icon: "🧺",
    category: "specialization",
    pointsValue: 40,
    requirements: { type: "laundry_jobs", value: 20 },
  },
  {
    name: "Rising Star",
    description: "Completed 10 cleans.",
    icon: "⭐",
    category: "achievement",
    pointsValue: 20,
    requirements: { type: "jobs_completed", value: 10 },
  },
  {
    name: "Century Cleaner",
    description: "Completed 100 cleans.",
    icon: "💯",
    category: "achievement",
    pointsValue: 100,
    requirements: { type: "jobs_completed", value: 100 },
  },
  {
    name: "Five-Star Favorite",
    description: "Average rating of 4.8+ across 5 or more rated cleans.",
    icon: "🌟",
    category: "performance",
    pointsValue: 60,
    requirements: { type: "avg_rating_min", value: 4.8, minCount: 5 },
  },
];
