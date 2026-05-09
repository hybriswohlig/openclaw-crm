// MessageBird REST adapter. Picked over Twilio per CEO default 2 on
// [KOT-603]: better DE deliverability, EU data residency, lower DE
// per-segment cost. Spend is billed under the [KOT-591] Reviews
// Engine line.
//
// API reference: https://developers.messagebird.com/api/sms-messaging/

import { MessagingSendError, type SendSmsResult } from "..";

const MESSAGEBIRD_BASE = "https://rest.messagebird.com";

export async function sendSmsViaMessageBird(to: string, body: string): Promise<SendSmsResult> {
  const apiKey = process.env.MESSAGEBIRD_API_KEY;
  const originator = process.env.MESSAGEBIRD_ORIGINATOR;
  if (!apiKey) {
    throw new MessagingSendError("MESSAGEBIRD_API_KEY is not set", { provider: "messagebird" });
  }
  if (!originator) {
    throw new MessagingSendError("MESSAGEBIRD_ORIGINATOR is not set", { provider: "messagebird" });
  }

  // MessageBird's /messages endpoint accepts form-urlencoded or JSON.
  // We use form-urlencoded because their docs lead with it and it
  // handles array `recipients` more reliably.
  const form = new URLSearchParams();
  form.set("originator", originator);
  form.set("recipients", to);
  form.set("body", body);
  // datacoding=auto picks GSM-7 vs UCS-2 per body content. We stick to
  // GSM-7-friendly bodies (no emoji) per spec §5 "no emoji" guidance,
  // but `auto` is the safe default if a non-GSM char ever sneaks in.
  form.set("datacoding", "auto");

  const res = await fetch(`${MESSAGEBIRD_BASE}/messages`, {
    method: "POST",
    headers: {
      Authorization: `AccessKey ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: form.toString(),
  });

  const json = (await res.json().catch(() => ({}))) as {
    id?: string;
    errors?: { code?: number; description?: string }[];
  };

  if (!res.ok) {
    const err = json.errors?.[0];
    const desc = err?.description ?? `MessageBird API error ${res.status}`;
    throw new MessagingSendError(`MessageBird send failed: ${desc}`, {
      provider: "messagebird",
      status: res.status,
      providerErrorCode: err?.code != null ? String(err.code) : null,
    });
  }

  if (!json.id) {
    throw new MessagingSendError("MessageBird returned no message id", {
      provider: "messagebird",
      status: res.status,
    });
  }

  return { id: json.id, channel: "sms" };
}
