import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "./logger";
import type { Mail } from "./notify";
import { normalizePhone } from "./phone";

// WhatsApp messages through the WhatsApp Business Cloud API (Meta). The
// office opens messages, so Meta requires an approved template. The template
// named in WHATSAPP_TEMPLATE_NAME must have one body variable ({{1}}) that
// carries the whole message. Off unless every setting is present.
//
// Within 24 hours of a message from the customer (hbs_customer_settings.
// last_inbound_at, set by the inbound webhook) Meta allows free-form text, so
// a reply inside that window is sent as plain text instead of the template.
//
// Settings (Replit secrets):
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME
//   WHATSAPP_TEMPLATE_LANGUAGE (default "ar"), WHATSAPP_GRAPH_VERSION (default "v21.0")
//   WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET   the inbound webhook (routes/whatsapp-webhook.ts)
//
// Like email, a message carries the reference and status only, and is sent
// after the change is saved; a failure is logged and never fails a request.

export const FREE_TEXT_WINDOW_MS = 24 * 60 * 60_000;

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);
}

// Saudi numbers as customers type them (05XXXXXXXX, 5XXXXXXXX, +9665…,
// 009665…) become 9665XXXXXXXX. Anything else is rejected.
export function saudiMobile(input: string): string | null {
  const phone = normalizePhone(input);
  return phone && /^05\d{8}$/.test(phone) ? `966${phone.slice(1)}` : null;
}

export function hashWhatsappChallenge(userId: string, localPhone: string, challengeText: string): string {
  return createHash("sha256").update(`${userId}\0${localPhone}\0${challengeText}`).digest("hex");
}

// Template variables may not contain new lines, tabs or more than four
// spaces in a row, and are limited to 1024 characters.
export function whatsappText(mail: Mail, siteUrl: string): string {
  const parts = [mail.heading, ...mail.lines, ...(mail.action ? [`${mail.action.label}: ${siteUrl}${mail.action.path}`] : [])];
  return parts.join(" · ").replace(/[\t\r\n]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1024);
}

// Whether a free-form reply is still allowed after the customer's last message.
export function freeTextWindowOpen(lastInboundAt: Date | null | undefined, now = Date.now()): boolean {
  return Boolean(lastInboundAt && now - lastInboundAt.getTime() < FREE_TEXT_WINDOW_MS);
}

async function post(payload: Record<string, unknown>, what: string): Promise<boolean> {
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, `WhatsApp ${what} failed`);
      return false;
    }
    logger.info(`WhatsApp ${what} sent`);
    return true;
  } catch (error) {
    logger.warn({ err: error }, `WhatsApp ${what} failed`);
    return false;
  }
}

// Free-form text; Meta accepts it only inside the 24-hour customer window.
// Needs the token and number but no template.
export async function sendText(to: string, body: string): Promise<boolean> {
  if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) return false;
  return post({ to, type: "text", text: { preview_url: false, body: body.slice(0, 4096) } }, "text message");
}

// The office's notification: plain text while the customer's window is open,
// the approved template otherwise.
export async function sendWhatsApp(to: string, text: string, lastInboundAt?: Date | null): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  if (freeTextWindowOpen(lastInboundAt)) return sendText(to, text);
  return post({
    to,
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE_NAME,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "ar" },
      components: [{ type: "body", parameters: [{ type: "text", text }] }],
    },
  }, "message");
}

// ---- inbound (webhook) -----------------------------------------------------------

// Meta signs each delivery with HMAC-SHA256 of the raw body under the app
// secret, sent as "sha256=<hex>" in X-Hub-Signature-256.
export function verifyWhatsappSignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type InboundTextMessage = { id: string; from: string; text: string };

// The text messages in a webhook delivery: entry[].changes[].value.messages[]
// of type "text". Status updates, reactions, media and malformed entries are
// left out; the caller records nothing for them.
export function parseInboundMessages(payload: unknown): InboundTextMessage[] {
  const messages: InboundTextMessage[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return messages;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: { messages?: unknown } })?.value;
      if (!Array.isArray(value?.messages)) continue;
      for (const message of value.messages as Record<string, unknown>[]) {
        const text = (message?.text as { body?: unknown } | undefined)?.body;
        if (message?.type !== "text" || typeof message.id !== "string" || typeof message.from !== "string" || typeof text !== "string") continue;
        const body = text.trim();
        if (!message.id || !message.from || !body) continue;
        messages.push({ id: message.id, from: message.from, text: body.slice(0, 4000) });
      }
    }
  }
  return messages;
}

// The stored spelling (05XXXXXXXX, as /portal/settings saves it) of the
// sender's number, which Meta gives as digits with the country code
// (9665XXXXXXXX). Null for anything but a Saudi mobile.
export function inboundPhoneLocal(from: string): string | null {
  const international = saudiMobile(from);
  return international ? `0${international.slice(3)}` : null;
}
