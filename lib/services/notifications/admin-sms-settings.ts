import "server-only";
import { normalizeSmsPhone } from "@/lib/sms/consent";
export function adminSmsSettings() {
  const enabled = process.env.ADMIN_SMS_ENABLED === "true";
  const schemaReady = process.env.ADMIN_SMS_SCHEMA_READY === "true";
  const recipient = process.env.ADMIN_SMS_TO?.trim().startsWith("+") ? normalizeSmsPhone(process.env.ADMIN_SMS_TO) : null;
  const service = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = normalizeSmsPhone(process.env.TWILIO_FROM_NUMBER);
  const senderKey = service && /^MG[0-9a-f]{32}$/i.test(service) ? `service:${service}` : !service && from ? `from:${from}` : null;
  const mode = process.env.ADMIN_SMS_ENVIRONMENT;
  const environment = mode === "test" || mode === "production" ? mode : null;
  const testRecipients = (process.env.ADMIN_SMS_TEST_RECIPIENTS ?? "").split(",").map(normalizeSmsPhone).filter(Boolean);
  const allowed = !!recipient && (environment === "production" || (environment === "test" && testRecipients.includes(recipient)));
  return { enabled, schemaReady, recipient, senderKey, environment, allowed };
}
