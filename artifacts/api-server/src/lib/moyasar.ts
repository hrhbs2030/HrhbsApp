// Online payment through Moyasar's hosted invoices (mada, Visa/Mastercard,
// Apple Pay). The customer pays on Moyasar's page, so card details never
// reach this server. A payment is trusted only after fetching the invoice
// from Moyasar with the secret key and checking its amount and currency.
//
// Settings (Replit secrets):
//   MOYASAR_SECRET_KEY        sk_live_… (sk_test_… for testing)
//   MOYASAR_WEBHOOK_SECRET    optional: the secret token set on the Moyasar webhook

const API = "https://api.moyasar.com/v1";

export function moyasarConfigured(): boolean {
  return Boolean(process.env.MOYASAR_SECRET_KEY);
}

export type GatewayInvoice = { id: string; status: string; amount: number; currency: string; url: string };

class GatewayError extends Error {}
export { GatewayError };

async function call(path: string, init: RequestInit = {}): Promise<GatewayInvoice> {
  const key = process.env.MOYASAR_SECRET_KEY;
  if (!key) throw new GatewayError("Online payment is not configured");
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
      "content-type": "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new GatewayError(`Payment gateway responded ${response.status}`);
  const body = await response.json() as Partial<GatewayInvoice>;
  if (typeof body.id !== "string" || typeof body.status !== "string" || typeof body.amount !== "number" ||
      typeof body.currency !== "string" || typeof body.url !== "string") {
    throw new GatewayError("Unexpected payment gateway response");
  }
  return body as GatewayInvoice;
}

export function createGatewayInvoice(input: { amount: number; description: string; successUrl: string; backUrl: string; callbackUrl?: string; metadata: Record<string, string> }) {
  return call("/invoices", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: "SAR",
      description: input.description,
      success_url: input.successUrl,
      back_url: input.backUrl,
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
      metadata: input.metadata,
    }),
  });
}

export function fetchGatewayInvoice(id: string) {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(id)) throw new GatewayError("Invalid gateway invoice ID");
  return call(`/invoices/${id}`);
}
