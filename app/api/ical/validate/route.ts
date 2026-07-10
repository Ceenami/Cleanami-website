import { NextRequest, NextResponse } from "next/server";
import ical from "node-ical";
import { z } from "zod";

export async function POST(request: NextRequest) {
  try {
    const { url } = (await request.json()) as { url?: string };

    const urlSchema = z.string().url("Invalid URL format.");
    const parsed = urlSchema.safeParse(url);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid_url" });
    }

    const data = await ical.async.fromURL(parsed.data);
    const now = new Date();
    let hasFutureEvents = false;

    for (const event of Object.values(data)) {
      if (event.type === "VEVENT" && event.end) {
        if (new Date(event.end) > now) {
          hasFutureEvents = true;
          break;
        }
      }
    }

    return NextResponse.json({
      status: hasFutureEvents ? "valid" : "no_future_events",
    });
  } catch (err) {
    console.error("[POST /api/ical/validate]", err);
    return NextResponse.json({ status: "invalid_url" });
  }
}
