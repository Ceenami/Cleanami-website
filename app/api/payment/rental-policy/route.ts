import { NextResponse } from "next/server";
import { newRentalFinancePolicy } from "@/lib/services/payment/rental-finance-settings";
export async function GET() {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    return NextResponse.json({ prepaidCredit: !!newRentalFinancePolicy() }, { headers });
  } catch {
    return NextResponse.json({ error: "Booking setup is unavailable. Please try again later." }, { status: 503, headers });
  }
}
