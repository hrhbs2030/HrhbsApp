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
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
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
}

export function createRateLimitMiddleware({
  limit = AI_REQUEST_LIMIT,
  windowMs = AI_REQUEST_WINDOW_MS,
  now = Date.now,
  maxTrackedIps = 10_000,
}: RateLimitOptions = {}): RequestHandler {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return (req, res, next) => {
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
      return res.status(429).json({
        error: "تم تجاوز حد طلبات الاستخراج. حاول مرة أخرى بعد قليل.",
      });
    }

    current.count += 1;
    return next();
  };
}