// Rules for request documents, kept free of I/O so they can be unit-tested.

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;
export const RETENTION_DAYS = 90;

export type FileType = "application/pdf" | "image/jpeg" | "image/png";
const extensions: Record<FileType, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

// The type is decided by the file's own first bytes, never by the name or
// the browser's claim, so a renamed executable is refused.
export function sniffFileType(bytes: Buffer): FileType | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

// A safe display name: no folders, no control or path characters, at most
// 120 characters, and an extension that matches the real type.
export function cleanFileName(raw: string | undefined, type: FileType): string | null {
  if (!raw) return null;
  let name: string;
  try { name = decodeURIComponent(raw); } catch { return null; }
  name = name.split(/[\\/]/).pop() ?? "";
  name = name.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  const ext = extensions[type];
  const base = name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim().slice(0, 110) || "مستند";
  return `${base}.${ext}`;
}

// Content-Disposition for a download, with an ASCII fallback and the real
// (often Arabic) name in RFC 5987 form.
export function attachmentHeader(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
}
