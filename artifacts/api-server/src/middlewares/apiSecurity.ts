import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

export const AI_REQUEST_BODY_LIMIT = "16kb";
export const AI_REQUEST_LIMIT = 10;
export const AI_REQUEST_WINDOW_MS = 60_000;

type SecurityEnvironment = Record<string, string | undefined>;

function normalizeOrigin(value: string): string | null {
  const candidate = value.includes("://") ? value : `https://${value}`;

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function parseOriginList(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map(normalizeOrigin)
    .filter((origin): origin is string => origin !== null);
}

export function getAllowedOrigins(
  env: SecurityEnvironment = process.env,
): Set<string> {
  const origins = new Set([
    ...parseOriginList(env.CORS_ALLOWED_ORIGINS),
    ...parseOriginList(env.REPLIT_DOMAINS),
  ]);

  if (env.NODE_ENV !== "production") {
    for (const origin of [
      "http://localhost:5173",
      "http://localhost:8081",
      "http://localhost:19006",
    ]) {
      origins.add(origin);
    }

    const devOrigin = env.REPLIT_DEV_DOMAIN
      ? normalizeOrigin(env.REPLIT_DEV_DOMAIN)
      : null;
    if (devOrigin) origins.add(devOrigin);
  }

  return origins;
}

export function createCorsOptions(
  allowedOrigins: Set<string>,
): CorsOptions {
  return {
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  };
}

export function createOriginGuard(
  allowedOrigins: Set<string>,
): RequestHandler {
  return (req, res, next) => {
    const origin = req.get("origin");
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({
        error: "هذا المصدر غير مسموح له باستخدام الخدمة.",
      });
    }

    return next();
  };
}

interface RateLimitOptions {
  limit?: number;
  windowMs?: number;
  now?: () => number;
  maxTrackedIps?: number;
  message?: string;
  // Requests this returns true for pass through without being counted.
  skip?: (req: Parameters<RequestHandler>[0]) => boolean;
}

export function createRateLimitMiddleware({
  limit = AI_REQUEST_LIMIT,
  windowMs = AI_REQUEST_WINDOW_MS,
  now = Date.now,
  maxTrackedIps = 10_000,
  message = "تم تجاوز حد طلبات الاستخراج. حاول مرة أخرى بعد قليل.",
  skip,
}: RateLimitOptions = {}): RequestHandler {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
    if (skip?.(req)) return next();
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const timestamp = now();
    const current = requests.get(ip);

    if (!current || current.resetAt <= timestamp) {
      if (requests.size >= maxTrackedIps) {
        for (const [trackedIp, entry] of requests) {
          if (entry.resetAt <= timestamp) requests.delete(trackedIp);
        }
        if (requests.size >= maxTrackedIps) {
          const oldestIp = requests.keys().next().value;
          if (oldestIp) requests.delete(oldestIp);
        }
      }

      requests.set(ip, { count: 1, resetAt: timestamp + windowMs });
      return next();
    }

    if (current.count >= limit) {
      res.set(
        "Retry-After",
        String(Math.max(1, Math.ceil((current.resetAt - timestamp) / 1000))),
      );
      return res.status(429).json({ error: message });
    }

    current.count += 1;
    return next();
  };
}
const RATE_LIMIT_MESSAGE = "طلبات كثيرة خلال وقت قصير. حاول مرة أخرى بعد قليل.";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Payment provider callbacks are verified by their own secret and may arrive
// in bursts from a few addresses, so the per-visitor limits leave them alone.
const UNLIMITED_PATHS = new Set(["/healthz", "/payments/moyasar/webhook"]);

// Endpoints that create something on behalf of a visitor (and may notify the
// office by email or WhatsApp): kept to a human pace.
const SENSITIVE_WRITES = [
  /^\/portal\/registration$/,
  /^\/inquiries$/,
  /^\/service-requests$/,
  /^\/service-requests\/[^/]+\/(messages|rating|attachments)$/,
  /^\/service-requests\/attachments\/upload-url$/,
  /^\/invoices\/[^/]+\/(pay|refresh)$/,
  /^\/(company|office\/customers\/[^/]+)\/(employees|licenses)\/import$/,
];

export const API_REQUEST_LIMIT = 600;
export const API_WRITE_LIMIT = 120;
export const API_SENSITIVE_WRITE_LIMIT = 20;

// Layered per-IP limits for the whole API (mounted at /api): every request,
// every write, and the writes listed above. AI extraction keeps its own
// stricter limit.
export function createApiRateLimits({
  now = Date.now,
  windowMs = 60_000,
}: { now?: () => number; windowMs?: number } = {}): RequestHandler[] {
  const exempt = (req: Parameters<RequestHandler>[0]) => UNLIMITED_PATHS.has(req.path);
  return [
    createRateLimitMiddleware({ limit: API_REQUEST_LIMIT, windowMs, now, message: RATE_LIMIT_MESSAGE, skip: exempt }),
    createRateLimitMiddleware({
      limit: API_WRITE_LIMIT, windowMs, now, message: RATE_LIMIT_MESSAGE,
      skip: (req) => exempt(req) || !WRITE_METHODS.has(req.method),
    }),
    createRateLimitMiddleware({
      limit: API_SENSITIVE_WRITE_LIMIT, windowMs, now, message: RATE_LIMIT_MESSAGE,
      skip: (req) => req.method !== "POST" || !SENSITIVE_WRITES.some((pattern) => pattern.test(req.path)),
    }),
  ];
}

// Response headers for a JSON API that holds personal data: never framed,
// never sniffed, never cached by browsers or shared proxies, no referrer.
export function createSecurityHeaders(
  env: SecurityEnvironment = process.env,
): RequestHandler {
  const production = env.NODE_ENV === "production";
  return (_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cache-Control", "no-store");
    if (production) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}
