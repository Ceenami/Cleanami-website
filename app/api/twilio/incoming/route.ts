import { NextResponse } from "next/server";
import twilio from "twilio";
import { recordCarrierSmsPreference } from "@/lib/services/cleaner-sms-consent";
import { normalizeSmsPhone } from "@/lib/sms/consent";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  // Must exactly match the public webhook URL configured in Twilio. Do not
  // construct a signature URL from untrusted Host / forwarded headers.
  const webhookUrl = process.env.TWILIO_INCOMING_WEBHOOK_URL;
  if (!token || !webhookUrl) return new NextResponse("Webhook unavailable", { status: 503 });
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) {
    return new NextResponse("Unsupported content type", { status: 415 });
  }
  const params = Object.fromEntries(new URLSearchParams(await request.text()));
  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (!twilio.validateRequest(token, signature, webhookUrl, params) ||
      params.AccountSid !== process.env.TWILIO_ACCOUNT_SID) {
    return new NextResponse("Invalid signature", { status: 403 });
  }
  const serviceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  if (serviceSid ? params.MessagingServiceSid !== serviceSid :
    normalizeSmsPhone(params.To) !== normalizeSmsPhone(process.env.TWILIO_FROM_NUMBER)) {
    return new NextResponse("Unexpected messaging sender", { status: 403 });
  }
  if (!normalizeSmsPhone(params.From) || !/^SM[0-9a-fA-F]{32}$/.test(params.MessageSid ?? "")) {
    return new NextResponse("Invalid message", { status: 400 });
  }
  // Advanced Opt-Out already replies to these keywords. Do not duplicate its
  // confirmation. Fallback supports standard Twilio long-code STOP filtering.
  const body = (params.Body ?? "").trim().toUpperCase();
  const type = params.OptOutType || (
    ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"].includes(body) ? "STOP" :
    ["START", "UNSTOP", "YES"].includes(body) ? "START" : ""
  );
  try {
    if (type === "STOP" || type === "START") {
      await recordCarrierSmsPreference(params.From, type === "STOP", params.MessageSid);
    }
  } catch {
    // Non-2xx lets Twilio retry if the consent database is unavailable.
    return new NextResponse("Could not record SMS preference", { status: 503 });
  }
  return new NextResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", {
    headers: { "Content-Type": "text/xml" },
  });
}
