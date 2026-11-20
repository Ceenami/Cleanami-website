import { NextResponse } from "next/server";
import twilio from "twilio";
import { MESSAGE_STATUS_RANK, recordMessageStatus } from "@/lib/services/notifications/message-status";
import { notificationWorkflowSchemaReady } from "@/lib/services/notifications/workflow-settings";
export async function POST(request: Request) {
  const token = process.env.TWILIO_AUTH_TOKEN, url = process.env.TWILIO_STATUS_WEBHOOK_URL;
  if (!notificationWorkflowSchemaReady() || !token || !url || !process.env.TWILIO_ACCOUNT_SID) return new NextResponse("Unavailable", { status: 503 });
  if (!request.headers.get("content-type")?.includes("application/x-www-form-urlencoded")) return new NextResponse("Unsupported content type", { status: 415 });
  if (Number(request.headers.get("content-length") ?? 0) > 16384) return new NextResponse("Request too large", { status: 413 });
  const body = await request.text();
  if (body.length > 16384) return new NextResponse("Request too large", { status: 413 });
  const params = Object.fromEntries(new URLSearchParams(body));
  // Configured external URL, never an untrusted Host/forwarded header.
  if (!twilio.validateRequest(token, request.headers.get("x-twilio-signature") ?? "", url, params) || params.AccountSid !== process.env.TWILIO_ACCOUNT_SID)
    return new NextResponse("Invalid signature", { status: 403 });
  if (!/^(SM|MM)[a-fA-F0-9]{32}$/.test(params.MessageSid ?? "") || !Object.hasOwn(MESSAGE_STATUS_RANK, params.MessageStatus ?? "") ||
      (params.ErrorCode && !/^\d{1,10}$/.test(params.ErrorCode))) return new NextResponse("Invalid status", { status: 400 });
  try { await recordMessageStatus(params.MessageSid, params.MessageStatus as keyof typeof MESSAGE_STATUS_RANK, params.ErrorCode || null); }
  catch { return new NextResponse("Status persistence unavailable", { status: 503 }); }
  return new NextResponse(null, { status: 204 });
}
