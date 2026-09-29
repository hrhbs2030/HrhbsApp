import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import {
  AI_REQUEST_BODY_LIMIT,
  AI_REQUEST_LIMIT,
  AI_REQUEST_WINDOW_MS,
  createCorsOptions,
  createOriginGuard,
  createRateLimitMiddleware,
  getAllowedOrigins,
} from "./middlewares/apiSecurity";

const app: Express = express();
const allowedOrigins = getAllowedOrigins();

// Use the platform proxy's client IP for rate limiting rather than treating
// every visitor as the proxy itself.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors(createCorsOptions(allowedOrigins)));
app.use(
  "/api/openai",
  createOriginGuard(allowedOrigins),
  createRateLimitMiddleware({
    limit: AI_REQUEST_LIMIT,
    windowMs: AI_REQUEST_WINDOW_MS,
  }),
  express.json({ limit: AI_REQUEST_BODY_LIMIT }),
);
app.use("/api/office/legacy", express.json({ limit: "6mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const error = err as { type?: string; status?: number };
    if (error?.type === "entity.too.large" || error?.status === 413) {
      return res.status(413).json({ error: "حجم الطلب أكبر من الحد المسموح." });
    }
    if (error?.type === "entity.parse.failed" || error?.status === 400) {
      return res.status(400).json({ error: "صيغة الطلب غير صالحة." });
    }
    return next(err);
  },
);

export default app;
