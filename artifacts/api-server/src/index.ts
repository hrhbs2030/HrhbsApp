import app from "./app";
import { logger } from "./lib/logger";
import { startExpiredRequestAttachmentCleanup } from "./lib/expired-request-attachments";
import { ensureRequestTrackingGuide } from "./lib/portal-usage-information";

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

ensureRequestTrackingGuide().then(() => app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startExpiredRequestAttachmentCleanup();
})).catch(err => {
  logger.error({ err }, "Failed to initialize portal usage information");
  process.exitCode = 1;
});
