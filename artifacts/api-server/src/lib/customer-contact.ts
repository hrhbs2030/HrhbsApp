import { clerkClient } from "@clerk/express";
import { eq } from "drizzle-orm";
import { db, hbsCustomerSettings, hbsRegistrationRequests } from "@workspace/db";
import { notify, sendMailNow, type Mail } from "./notify";
import { saudiMobile, sendWhatsApp, whatsappConfigured, whatsappText } from "./whatsapp";

// The address the customer registered with, for notifications.
// Runs after the response is sent, so a lookup failure only skips the email.
export async function customerEmail(userId: string): Promise<string | null> {
  try {
    const [registration] = await db.select({ email: hbsRegistrationRequests.email })
      .from(hbsRegistrationRequests).where(eq(hbsRegistrationRequests.userId, userId)).limit(1);
    if (registration?.email) return registration.email;
    // Customers from before registration existed: their verified sign-in email.
    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    return primary?.verification?.status === "verified" ? primary.emailAddress : null;
  } catch {
    return null;
  }
}

const siteUrl = () => (process.env.PUBLIC_SITE_URL ?? "https://hrhbs.com").replace(/\/$/, "");

// Email, plus WhatsApp when the customer has opted in. The mail builder gets
// the customer's email (or null) so the same message serves both channels.
export async function notifyCustomer(userId: string, build: (to: string | null) => Mail | null): Promise<void> {
  const email = await customerEmail(userId);
  const mail = build(email);
  if (mail) notify(mail);
  await whatsappCustomer(userId, mail, build);
}

// Like notifyCustomer, but rejects when the email cannot be sent, so a
// reminder sweep can give its claim back and try again later. WhatsApp is
// still best effort.
export async function notifyCustomerNow(userId: string, build: (to: string | null) => Mail | null, send: typeof sendMailNow = sendMailNow): Promise<void> {
  const email = await customerEmail(userId);
  const mail = build(email);
  if (mail) await send(mail);
  await whatsappCustomer(userId, mail, build);
}

async function whatsappCustomer(userId: string, mail: Mail | null, build: (to: string | null) => Mail | null): Promise<void> {
  if (!whatsappConfigured()) return;
  try {
    const [settings] = await db.select().from(hbsCustomerSettings).where(eq(hbsCustomerSettings.userId, userId)).limit(1);
    const phone = settings?.whatsappOptIn && settings.whatsappPhone ? saudiMobile(settings.whatsappPhone) : null;
    // With no email address the builder returns null; build the text again
    // with a placeholder address (only the text is used for WhatsApp).
    const message = mail ?? build("whatsapp-only");
    // A customer who wrote to the office within 24 hours gets plain text instead of the template.
    if (phone && message) await sendWhatsApp(phone, whatsappText(message, siteUrl()), settings?.lastInboundAt);
  } catch {
    // Logged inside sendWhatsApp; a settings lookup failure only skips WhatsApp.
  }
}
