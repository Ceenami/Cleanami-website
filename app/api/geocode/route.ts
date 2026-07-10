import { NextRequest, NextResponse } from "next/server";
import {
  geocodeAllCleaners,
  geocodeAllProperties,
} from "@/lib/services/google-maps/geocoding";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims;
    const userRole = user?.user_metadata?.role;

    if (userRole !== "admin" && userRole !== "super_admin") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { target } = await request.json();

    const results = {
      cleaners: { geocoded: 0, total: 0 },
      properties: { geocoded: 0, total: 0 },
    };

    if (target === "cleaners" || target === "all") {
      console.log("Geocoding cleaners...");
      await geocodeAllCleaners((current, total) => {
        results.cleaners = { geocoded: current, total };
        console.log(`Cleaners: ${current}/${total}`);
      });
    }

    if (target === "properties" || target === "all") {
      console.log("Geocoding properties...");
      await geocodeAllProperties((current, total) => {
        results.properties = { geocoded: current, total };
        console.log(`Properties: ${current}/${total}`);
      });
    }

    return NextResponse.json({
      success: true,
      results,
      message: "Geocoding complete",
    });
  } catch (error) {
    console.error("Geocoding error:", error);
    return NextResponse.json(
      {
        error: "Failed to geocode addresses",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  const { db } = await import("@/db");
  const { cleaners, properties } = await import("@/db/schemas");
  const { isNull } = await import("drizzle-orm");

  try {
    const [
      cleanersWithoutCoords,
      propertiesWithoutCoords,
      cleanersWithCoords,
      propertiesWithCoords,
    ] = await Promise.all([
      db.query.cleaners.findMany({
        where: isNull(cleaners.latitude),
        columns: { id: true },
      }),
      db.query.properties.findMany({
        where: isNull(properties.latitude),
        columns: { id: true },
      }),
      db.query.cleaners.findMany({
        columns: { id: true, latitude: true },
      }),
      db.query.properties.findMany({
        columns: { id: true, latitude: true },
      }),
    ]);

    return NextResponse.json({
      cleaners: {
        total: cleanersWithCoords.length,
        geocoded: cleanersWithCoords.filter((c) => c.latitude).length,
        remaining: cleanersWithoutCoords.length,
      },
      properties: {
        total: propertiesWithCoords.length,
        geocoded: propertiesWithCoords.filter((p) => p.latitude).length,
        remaining: propertiesWithoutCoords.length,
      },
    });
  } catch (error) {
    console.error("Error fetching geocode status:", error);
    return NextResponse.json(
      { error: "Failed to fetch status" },
      { status: 500 }
    );
  }
}
