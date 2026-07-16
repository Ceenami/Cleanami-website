// scripts/seed-badges.ts
// Seed / upsert the badge catalog. Run with: tsx scripts/seed-badges.ts
import { config } from "dotenv";
import postgres from "postgres";
import { BADGE_DEFINITIONS } from "../lib/services/badges/badge-definitions";

config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set");
  process.exit(1);
}

async function seed() {
  const sql = postgres(DATABASE_URL!, { max: 1 });
  try {
    for (const b of BADGE_DEFINITIONS) {
      await sql`
        INSERT INTO badges (name, description, icon, category, requirements, points_value)
        VALUES (${b.name}, ${b.description}, ${b.icon}, ${b.category}, ${sql.json(b.requirements)}, ${b.pointsValue})
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          icon = EXCLUDED.icon,
          category = EXCLUDED.category,
          requirements = EXCLUDED.requirements,
          points_value = EXCLUDED.points_value
      `;
      console.log(`✓ Seeded badge: ${b.name}`);
    }
    console.log(`✅ Seeded ${BADGE_DEFINITIONS.length} badges.`);
  } catch (error) {
    console.error("❌ Error seeding badges:", error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

seed();
