import type { ErrorRequestHandler, RequestHandler } from "express";
import { logger } from "../lib/logger";

// The request ID pino-http assigned, returned to the client so a support
// report can be matched to the server log line.
export const requestIdHeader: RequestHandler = (req, res, next) => {
  if (req.id !== undefined) res.setHeader("X-Request-Id", String(req.id));
  next();
};

// Unknown API paths answer in JSON like every other API error, never with
// Express's HTML page.
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "غير موجود" });
};

// Body parser failures: too large or not JSON.
export const bodyErrors: ErrorRequestHandler = (err, _req, res, next) => {
  const error = err as { type?: string; status?: number };
  if (error?.type === "entity.too.large" || error?.status === 413) {
    res.status(413).json({ error: "حجم الطلب أكبر من الحد المسموح." });
    return;
  }
  if (error?.type === "entity.parse.failed" || error?.status === 400) {
    res.status(400).json({ error: "صيغة الطلب غير صالحة." });
    return;
  }
  next(err);
};

// Last resort: anything a route let through is logged with the request and
// answered with a generic message, never the error itself.
export const unhandledError: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) { next(err); return; }
  (req.log ?? logger).error({ err }, "Unhandled request error");
  // The same text as the X-Request-Id header, so either can be quoted to support.
  res.status(500).json({ error: "حدث خطأ غير متوقع. حاول مرة أخرى.", requestId: req.id === undefined ? null : String(req.id) });
};
