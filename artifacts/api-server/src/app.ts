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
  createApiRateLimits,
  createCorsOptions,
  createOriginGuard,
  createRateLimitMiddleware,
  createSecurityHeaders,
  getAllowedOrigins,
} from "./middlewares/apiSecurity";
import { apiNotFound, bodyErrors, requestIdHeader, unhandledError } from "./middlewares/errors";

const app: Express = express();
const allowedOrigins = getAllowedOrigins();
app.disable("x-powered-by");

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
app.use(requestIdHeader);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
app.use(cors(createCorsOptions(allowedOrigins)));
app.use("/api", createSecurityHeaders(), ...createApiRateLimits());
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
// Spreadsheet imports send up to 500 rows at once.
app.use(/^\/api\/(company|office\/customers\/[^/]+)\/(employees|licenses)\/import$/, express.json({ limit: "1mb" }));
app.use(express.json());

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);
app.use("/api", apiNotFound);

app.use(bodyErrors);
app.use(unhandledError);

export default app;
