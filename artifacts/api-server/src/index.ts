import type { Server } from "node:http";
import app from "./app";
import { pool } from "@workspace/db";
import { logger } from "./lib/logger";
import { startExpiredRequestAttachmentCleanup } from "./lib/expired-request-attachments";
import { ensureRequestTrackingGuide } from "./lib/portal-usage-information";
import { startDocumentReminders } from "./lib/document-reminders";
import { startPaymentReconciliation } from "./routes/billing";
import { startInvoiceReminders } from "./lib/invoice-reminders";
import { beginShutdown, drainJobs, inFlightCount } from "./lib/lifecycle";
import { startNotificationJobs } from "./lib/notification-digest";
import { closeNotificationStreams } from "./routes/notifications";
import { startSubscriptionRenewals } from "./lib/subscriptions";
import { startWhatsappInboundPurge } from "./routes/whatsapp-webhook";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// How long a deploy waits for the sweeps in flight (a reminder claimed but
// not yet mailed, a payment being settled) before the pool is closed.
export const SHUTDOWN_GRACE_MS = 10_000;

// SIGTERM/SIGINT: stop taking requests, end the open event streams (the
// clients reconnect to the next server), let the running sweeps finish
// within the grace period, close the pool, exit. A second signal, or the
// grace period plus a margin, exits at once.
function installGracefulShutdown(server: Server) {
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) { logger.warn({ signal }, "Second signal; exiting now"); process.exit(1); }
    stopping = true;
    beginShutdown();
    logger.info({ signal, jobs: inFlightCount() }, "Shutting down");
    const hardStop = setTimeout(() => { logger.error("Shutdown grace period exceeded; exiting"); process.exit(1); }, SHUTDOWN_GRACE_MS + 2_000);
    hardStop.unref();
    const closed = new Promise<void>(resolve => server.close(() => resolve()));
    const streams = closeNotificationStreams();
    if (streams) logger.info({ streams }, "Closed notification streams");
    void (async () => {
      const finished = await drainJobs(SHUTDOWN_GRACE_MS);
      if (!finished) logger.warn({ jobs: inFlightCount() }, "Background jobs did not finish within the grace period");
      await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 1_000).unref())]);
      try { await pool.end(); } catch (err) { logger.warn({ err }, "Pool did not close cleanly"); }
      logger.info("Shutdown complete");
      process.exit(finished ? 0 : 1);
    })();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

ensureRequestTrackingGuide().then(() => {
  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");
    startExpiredRequestAttachmentCleanup();
    startDocumentReminders();
    startPaymentReconciliation();
    startInvoiceReminders();
    startSubscriptionRenewals();
    startNotificationJobs();
    startWhatsappInboundPurge();
  });
  installGracefulShutdown(server);
}).catch(err => {
  logger.error({ err }, "Failed to initialize portal usage information");
  process.exitCode = 1;
});
