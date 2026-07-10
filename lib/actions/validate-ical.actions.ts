"use server";

import ical from "node-ical";
import { z } from "zod";

type ValidationResult = {
  status: "valid" | "invalid_url" | "no_future_events";
  error?: string;
};

export async function validateIcalUrl(url: string): Promise<ValidationResult> {
  const urlSchema = z.url("Invalid URL format.");
  const validationResult = urlSchema.safeParse(url);

  if (!validationResult.success) {
    return { status: "invalid_url", error: validationResult.error.message };
  }

  try {
    const data = await ical.async.fromURL(url);
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

    if (hasFutureEvents) {
      return { status: "valid" };
    } else {
      return { status: "no_future_events" };
    }
  } catch (error) {
    console.error("iCal validation error:", error);
    return {
      status: "invalid_url",
      error: "Could not fetch or parse the calendar link.",
    };
  }
}
