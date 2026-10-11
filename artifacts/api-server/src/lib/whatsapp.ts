import { logger } from "./logger";
import type { Mail } from "./notify";

// WhatsApp messages through the WhatsApp Business Cloud API (Meta). The
// office opens messages, so Meta requires an approved template. The template
// named in WHATSAPP_TEMPLATE_NAME must have one body variable ({{1}}) that
// carries the whole message. Off unless every setting is present.
//
// Settings (Replit secrets):
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME
//   WHATSAPP_TEMPLATE_LANGUAGE (default "ar"), WHATSAPP_GRAPH_VERSION (default "v21.0")
//
// Like email, a message carries the reference and status only, and is sent
// after the change is saved; a failure is logged and never fails a request.

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TEMPLATE_NAME);
}

// Saudi numbers as customers type them (05XXXXXXXX, 5XXXXXXXX, +9665…,
// 009665…) become 9665XXXXXXXX. Anything else is rejected.
export function saudiMobile(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (!/^\d+$/.test(digits)) return null;
  const local = digits.startsWith("966") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^5\d{8}$/.test(local) ? `966${local}` : null;
}

// Template variables may not contain new lines, tabs or more than four
// spaces in a row, and are limited to 1024 characters.
export function whatsappText(mail: Mail, siteUrl: string): string {
  const parts = [mail.heading, ...mail.lines, ...(mail.action ? [`${mail.action.label}: ${siteUrl}${mail.action.path}`] : [])];
  return parts.join(" · ").replace(/[\t\r\n]+/g, " ").replace(/ {4,}/g, "   ").slice(0, 1024);
}

export async function sendWhatsApp(to: string, text: string): Promise<boolean> {
  if (!whatsappConfigured()) return false;
  const version = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
  try {
    const response = await fetch(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: process.env.WHATSAPP_TEMPLATE_NAME,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "ar" },
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, "WhatsApp message failed");
      return false;
    }
    logger.info("WhatsApp message sent");
    return true;
  } catch (error) {
    logger.warn({ err: error }, "WhatsApp message failed");
    return false;
  }
}
