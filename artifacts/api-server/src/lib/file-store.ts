import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Where request documents are kept. Private: objects are never served
// directly, only through the access-checked routes in routes/files.ts.
//
//   HBS_FILE_STORE=replit   Replit App Storage (object storage). The default
//                           on Replit; HBS_STORAGE_BUCKET_ID picks a bucket
//                           other than the app's default one.
//   HBS_FILE_STORE=local    a folder on disk (HBS_FILE_DIR, ./.uploads), for
//                           development only.
//   HBS_FILE_STORE=memory   in-process, for tests.

export interface FileStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

class MemoryStore implements FileStore {
  private objects = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) { this.objects.set(key, Buffer.from(bytes)); }
  async get(key: string) { return this.objects.get(key) ?? null; }
  async remove(key: string) { this.objects.delete(key); }
}

class LocalStore implements FileStore {
  constructor(private root: string) {}
  private file(key: string) {
    const target = path.resolve(this.root, key);
    if (!target.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return target;
  }
  async put(key: string, bytes: Buffer) {
    const target = this.file(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  async get(key: string) {
    try { return await readFile(this.file(key)); } catch { return null; }
  }
  async remove(key: string) { await rm(this.file(key), { force: true }); }
}

type ReplitResult<T> = { ok: boolean; value?: T; error?: unknown };
type ReplitClient = {
  uploadFromBytes(name: string, bytes: Buffer): Promise<ReplitResult<null>>;
  downloadAsBytes(name: string): Promise<ReplitResult<[Buffer] | Buffer>>;
  delete(name: string, options?: { ignoreNotFound?: boolean }): Promise<ReplitResult<null>>;
};

class ReplitStore implements FileStore {
  private client: Promise<ReplitClient> | null = null;
  private connect(): Promise<ReplitClient> {
    this.client ??= import("@replit/object-storage").then(({ Client }) => {
      const bucketId = process.env.HBS_STORAGE_BUCKET_ID;
      return new Client(bucketId ? { bucketId } : undefined) as unknown as ReplitClient;
    });
    return this.client;
  }
  async put(key: string, bytes: Buffer) {
    const result = await (await this.connect()).uploadFromBytes(key, bytes);
    if (!result.ok) throw new Error(`Object storage upload failed: ${String(result.error)}`);
  }
  async get(key: string) {
    const result = await (await this.connect()).downloadAsBytes(key);
    if (!result.ok || !result.value) return null;
    return Array.isArray(result.value) ? result.value[0] : result.value;
  }
  async remove(key: string) {
    const result = await (await this.connect()).delete(key, { ignoreNotFound: true });
    if (!result.ok) throw new Error(`Object storage delete failed: ${String(result.error)}`);
  }
}

let store: FileStore | null = null;
export function fileStore(): FileStore {
  if (store) return store;
  const kind = process.env.HBS_FILE_STORE ?? (process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT ? "replit" : "local");
  store = kind === "memory" ? new MemoryStore()
    : kind === "replit" ? new ReplitStore()
    : new LocalStore(process.env.HBS_FILE_DIR ?? path.resolve(process.cwd(), ".uploads"));
  return store;
}
