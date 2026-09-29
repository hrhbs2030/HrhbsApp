import { randomUUID } from "node:crypto";
import { getAuth } from "@clerk/express";
import { and, count, desc, eq, isNull, lt } from "drizzle-orm";
import express, { Router, type IRouter, type Request, type Response } from "express";
import { db, hbsRequestFiles, hbsServiceRequests, type HbsRequestFile, type HbsServiceRequest } from "@workspace/db";
import {
  DeleteOfficeServiceRequestFileParams,
  DeleteServiceRequestFileParams,
  DownloadOfficeServiceRequestFileParams,
  DownloadServiceRequestFileParams,
  ListOfficeServiceRequestFilesParams,
  ListOfficeServiceRequestFilesResponse,
  ListServiceRequestFilesParams,
  ListServiceRequestFilesResponse,
  UploadOfficeServiceRequestFileParams,
  UploadOfficeServiceRequestFileResponse,
  UploadServiceRequestFileParams,
  UploadServiceRequestFileResponse,
} from "@workspace/api-zod";
import { recordAudit } from "../lib/audit";
import { customerEmail, requestReference } from "../lib/customers";
import { fileStore } from "../lib/file-store";
import { logger } from "../lib/logger";
import { customerNewFileMail, notify, officeNewFileMail } from "../lib/notify";
import { requireOfficeStaff } from "../lib/office-access";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_REQUEST,
  attachmentHeader,
  cleanFileName,
  retentionCutoff,
  sniffFileType,
} from "../lib/request-files";
import { requireApprovedCustomer } from "./portal";

// Documents attached to service requests. Customers reach only files on their
// own requests; office staff reach all. Every office upload, download and
// removal is written to the audit log. Files are removed 90 days after their
// request is completed (see purgeExpiredFiles).

const router: IRouter = Router();
const rawFile = express.raw({ type: "application/octet-stream", limit: MAX_FILE_BYTES });

type Scope = "customer" | "office";

function publicFile(file: HbsRequestFile) {
  return {
    id: file.id,
    fileName: file.fileName,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    uploaderRole: file.uploaderRole,
    createdAt: file.createdAt,
    deletedAt: file.deletedAt,
    deletedReason: file.deletedReason,
  };
}

// The request, if this caller may see it: its owner, or any office staff.
async function findRequest(scope: Scope, req: Request, id: number): Promise<HbsServiceRequest | undefined> {
  const where = scope === "office"
    ? eq(hbsServiceRequests.id, id)
    : and(eq(hbsServiceRequests.id, id), eq(hbsServiceRequests.userId, getAuth(req).userId!));
  const [request] = await db.select().from(hbsServiceRequests).where(where).limit(1);
  return request;
}

async function findFile(requestId: number, fileId: number): Promise<HbsRequestFile | undefined> {
  const [file] = await db.select().from(hbsRequestFiles)
    .where(and(eq(hbsRequestFiles.id, fileId), eq(hbsRequestFiles.requestId, requestId))).limit(1);
  return file;
}

const validId = (value: number) => Number.isInteger(value) && value > 0;

function listHandler(scope: Scope) {
  return async (req: Request, res: Response): Promise<void> => {
    const params = (scope === "office" ? ListOfficeServiceRequestFilesParams : ListServiceRequestFilesParams).safeParse(req.params);
    if (!params.success || !validId(params.data.id)) { res.status(400).json({ error: "Invalid request ID" }); return; }
    const request = await findRequest(scope, req, params.data.id);
    if (!request) { res.status(404).json({ error: "Request not found" }); return; }
    const files = await db.select().from(hbsRequestFiles)
      .where(eq(hbsRequestFiles.requestId, request.id))
      .orderBy(desc(hbsRequestFiles.createdAt), desc(hbsRequestFiles.id));
    const schema = scope === "office" ? ListOfficeServiceRequestFilesResponse : ListServiceRequestFilesResponse;
    res.json(schema.parse(files.map(publicFile)));
  };
}

function uploadHandler(scope: Scope) {
  return async (req: Request, res: Response): Promise<void> => {
    const params = (scope === "office" ? UploadOfficeServiceRequestFileParams : UploadServiceRequestFileParams).safeParse(req.params);
    if (!params.success || !validId(params.data.id)) { res.status(400).json({ error: "Invalid request ID" }); return; }
    const request = await findRequest(scope, req, params.data.id);
    if (!request) { res.status(404).json({ error: "Request not found" }); return; }
    if (scope === "customer" && request.status === "completed") {
      res.status(409).json({ error: "The request is completed" });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : null;
    if (!bytes || bytes.length === 0) { res.status(400).json({ error: "Attach a file" }); return; }
    if (bytes.length > MAX_FILE_BYTES) { res.status(413).json({ error: "File larger than 10 MB" }); return; }
    const type = sniffFileType(bytes);
    if (!type) { res.status(415).json({ error: "Only PDF, JPEG and PNG files are accepted" }); return; }
    const fileName = cleanFileName(req.get("x-file-name"), type);
    if (!fileName) { res.status(400).json({ error: "Invalid file name" }); return; }

    const [{ active }] = await db.select({ active: count() }).from(hbsRequestFiles)
      .where(and(eq(hbsRequestFiles.requestId, request.id), isNull(hbsRequestFiles.deletedAt)));
    if (active >= MAX_FILES_PER_REQUEST) {
      res.status(409).json({ error: `A request can hold ${MAX_FILES_PER_REQUEST} files` });
      return;
    }

    const userId = getAuth(req).userId!;
    const storageKey = `requests/${request.id}/${randomUUID()}`;
    await fileStore().put(storageKey, bytes);
    let saved: HbsRequestFile;
    try {
      saved = await db.transaction(async (tx) => {
        const [file] = await tx.insert(hbsRequestFiles).values({
          requestId: request.id, uploadedBy: userId, uploaderRole: scope,
          fileName, contentType: type, sizeBytes: bytes.length, storageKey,
        }).returning();
        if (scope === "office") {
          await recordAudit(tx, {
            actorId: userId, action: "request_file.upload", targetType: "service_request", targetId: request.id,
            details: { fileId: file.id, fileName },
          });
        }
        return file;
      });
    } catch (error) {
      await fileStore().remove(storageKey).catch(() => undefined);
      throw error;
    }

    const schema = scope === "office" ? UploadOfficeServiceRequestFileResponse : UploadServiceRequestFileResponse;
    res.status(201).json(schema.parse(publicFile(saved)));
    const info = { id: request.id, reference: requestReference(request.id, request.createdAt), service: request.service };
    if (scope === "office") notify(customerNewFileMail(await customerEmail(request.userId), info));
    else notify(officeNewFileMail(info, fileName));
  };
}

function downloadHandler(scope: Scope) {
  return async (req: Request, res: Response): Promise<void> => {
    const params = (scope === "office" ? DownloadOfficeServiceRequestFileParams : DownloadServiceRequestFileParams).safeParse(req.params);
    if (!params.success || !validId(params.data.id) || !validId(params.data.fileId)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const request = await findRequest(scope, req, params.data.id);
    const file = request && await findFile(request.id, params.data.fileId);
    if (!request || !file || file.deletedAt) { res.status(404).json({ error: "File not found" }); return; }
    const bytes = await fileStore().get(file.storageKey);
    if (!bytes) {
      logger.error({ fileId: file.id }, "Stored file is missing");
      res.status(404).json({ error: "File not found" });
      return;
    }
    if (scope === "office") {
      await db.transaction(async (tx) => recordAudit(tx, {
        actorId: getAuth(req).userId!, action: "request_file.download", targetType: "service_request", targetId: request.id,
        details: { fileId: file.id, fileName: file.fileName },
      }));
    }
    res.set({
      "Content-Type": file.contentType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": attachmentHeader(file.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    });
    res.end(bytes);
  };
}

function deleteHandler(scope: Scope) {
  return async (req: Request, res: Response): Promise<void> => {
    const params = (scope === "office" ? DeleteOfficeServiceRequestFileParams : DeleteServiceRequestFileParams).safeParse(req.params);
    if (!params.success || !validId(params.data.id) || !validId(params.data.fileId)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const userId = getAuth(req).userId!;
    const request = await findRequest(scope, req, params.data.id);
    const file = request && await findFile(request.id, params.data.fileId);
    if (!request || !file || file.deletedAt) { res.status(404).json({ error: "File not found" }); return; }
    // Customers may take back their own uploads until the request is completed.
    if (scope === "customer" && (file.uploaderRole !== "customer" || file.uploadedBy !== userId || request.status === "completed")) {
      res.status(409).json({ error: "This file can no longer be removed" });
      return;
    }
    await fileStore().remove(file.storageKey);
    await db.transaction(async (tx) => {
      await tx.update(hbsRequestFiles).set({ deletedAt: new Date(), deletedReason: scope === "office" ? "office" : "uploader" })
        .where(eq(hbsRequestFiles.id, file.id));
      if (scope === "office") {
        await recordAudit(tx, {
          actorId: userId, action: "request_file.delete", targetType: "service_request", targetId: request.id,
          details: { fileId: file.id, fileName: file.fileName },
        });
      }
    });
    res.status(204).end();
  };
}

router.get("/service-requests/:id/files", requireApprovedCustomer, listHandler("customer"));
router.post("/service-requests/:id/files", requireApprovedCustomer, rawFile, uploadHandler("customer"));
router.get("/service-requests/:id/files/:fileId/content", requireApprovedCustomer, downloadHandler("customer"));
router.delete("/service-requests/:id/files/:fileId", requireApprovedCustomer, deleteHandler("customer"));

router.get("/office/service-requests/:id/files", requireOfficeStaff, listHandler("office"));
router.post("/office/service-requests/:id/files", requireOfficeStaff, rawFile, uploadHandler("office"));
router.get("/office/service-requests/:id/files/:fileId/content", requireOfficeStaff, downloadHandler("office"));
router.delete("/office/service-requests/:id/files/:fileId", requireOfficeStaff, deleteHandler("office"));

// Removes files of requests completed more than RETENTION_DAYS ago. Safe to
// run repeatedly; each removal is audited as the "system" actor.
export async function purgeExpiredFiles(now = new Date()): Promise<number> {
  const expired = await db.select({ file: hbsRequestFiles }).from(hbsRequestFiles)
    .innerJoin(hbsServiceRequests, eq(hbsRequestFiles.requestId, hbsServiceRequests.id))
    .where(and(
      isNull(hbsRequestFiles.deletedAt),
      eq(hbsServiceRequests.status, "completed"),
      lt(hbsServiceRequests.updatedAt, retentionCutoff(now)),
    ));
  let removed = 0;
  for (const { file } of expired) {
    try {
      await fileStore().remove(file.storageKey);
      await db.transaction(async (tx) => {
        await tx.update(hbsRequestFiles).set({ deletedAt: now, deletedReason: "retention" }).where(eq(hbsRequestFiles.id, file.id));
        await recordAudit(tx, {
          actorId: "system", action: "request_file.purge", targetType: "service_request", targetId: file.requestId,
          details: { fileId: file.id, fileName: file.fileName },
        });
      });
      removed += 1;
    } catch (error) {
      logger.warn({ err: error, fileId: file.id }, "Could not purge an expired file");
    }
  }
  if (removed) logger.info({ removed }, "Purged expired request files");
  return removed;
}

// Runs the purge shortly after start, then every six hours.
export function scheduleFilePurge(): void {
  const run = () => { purgeExpiredFiles().catch((error) => logger.warn({ err: error }, "File purge failed")); };
  setTimeout(run, 60_000).unref();
  setInterval(run, 6 * 60 * 60_000).unref();
}

export default router;
