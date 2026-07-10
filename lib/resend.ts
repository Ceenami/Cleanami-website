import { Resend } from "resend";
import { SERVICE_UNAVAILABLE } from "@/lib/env/messages";

let resendClient: Resend | null | undefined;

export function getResend(): Resend | null {
  if (resendClient !== undefined) {
    return resendClient;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    resendClient = null;
    return null;
  }

  resendClient = new Resend(apiKey);
  return resendClient;
}

export function getEmailUnavailableMessage(): string {
  return SERVICE_UNAVAILABLE.email;
}

export const EMAIL_FROM = "CleanNami <booking@cleanami.ceenami.com>";

export const resend = new Proxy({} as Resend, {
  get(_target, prop, receiver) {
    const client = getResend();
    if (!client) {
      throw new Error(SERVICE_UNAVAILABLE.email);
    }

    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
