import { asciiDigits } from "./phone";

// Commercial register lookups at Wathq (the Saudi Business Center's data
// service). Both the base URL and the key header follow Wathq's published
// docs for the commercial registration API and may need adjusting once the
// office's subscription is set up. Off unless WATHQ_API_KEY is set.
export const WATHQ_BASE_URL = "https://api.wathq.sa/v5/commercialregistration";
export const WATHQ_API_KEY_HEADER = "apiKey";
const TIMEOUT_MS = 10_000;

export type CommercialRegister = {
  name: string;
  unifiedNumber: string | null;
  status: string | null;
  activity: string | null;
  city: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
};

export class WathqError extends Error {
  constructor(readonly kind: "not_found" | "failed", message: string) { super(message); }
}

export function wathqConfigured(): boolean {
  return Boolean(process.env.WATHQ_API_KEY);
}

// A CR number as customers type it: 10 digits, Arabic digits accepted.
export function commercialRegisterNumber(input: string): string | null {
  const digits = asciiDigits(input).replace(/\s/g, "");
  return /^\d{10}$/.test(digits) ? digits : null;
}

const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Maps whatever fields the response carries; Wathq's shape has changed
// between versions, so each field is optional and missing ones are null.
export function parseCommercialRegister(payload: unknown): CommercialRegister | null {
  const data = record(payload);
  if (!data) return null;
  const name = text(data.crName) ?? text(data.name);
  if (!name) return null;
  const status = record(data.status);
  const activities = Array.isArray(data.activities)
    ? data.activities.map(item => text(record(item)?.name) ?? text(item)).filter((item): item is string => item !== null) : [];
  const location = record(data.location);
  return {
    name,
    unifiedNumber: text(data.crEntityNumber) ?? text(data.unifiedNumber) ?? null,
    status: text(status?.name) ?? text(data.status) ?? null,
    activity: activities.length ? activities.join("، ") : text(record(data.activity)?.name) ?? null,
    city: text(data.headquarterCityName) ?? text(location?.name) ?? text(location?.city) ?? null,
    issuedOn: text(data.issueDate) ?? null,
    expiresOn: text(data.expiryDate) ?? null,
  };
}

export async function lookupCommercialRegister(number: string, fetchImpl: typeof fetch = fetch): Promise<CommercialRegister> {
  const apiKey = process.env.WATHQ_API_KEY;
  if (!apiKey) throw new WathqError("failed", "Wathq is not configured");
  let response: Response;
  try {
    response = await fetchImpl(`${WATHQ_BASE_URL}/info/${encodeURIComponent(number)}`, {
      headers: { [WATHQ_API_KEY_HEADER]: apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new WathqError("failed", `Wathq request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 404) throw new WathqError("not_found", "No commercial register with that number");
  if (!response.ok) throw new WathqError("failed", `Wathq answered ${response.status}`);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new WathqError("failed", "Wathq answered with something other than JSON"); }
  const parsed = parseCommercialRegister(payload);
  if (!parsed) throw new WathqError("failed", "Wathq answered without a register name");
  return parsed;
}
