import "server-only";

import fs from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";

export type StoredObject = {
  /** Stable id (also used as the basename without extension). */
  id: string;
  /**
   * Path returned to clients to fetch the image.
   * For the disk adapter, this is `/uploads/<id>.<ext>` and is served by the
   * `/uploads/[...path]` route handler.
   */
  publicPath: string;
  /** Absolute filesystem path (disk adapter only — undefined for cloud). */
  absolutePath?: string;
};

export interface Storage {
  /**
   * Persist a buffer and return a stable id + a public URL path that the
   * frontend (or AI extractor) can use to fetch it.
   */
  put(input: { buffer: Buffer; ext: string; mimeType: string }): Promise<StoredObject>;

  /** Delete an object by id. Idempotent. */
  delete(id: string): Promise<void>;

  /** Resolve a stored id back to a buffer (used by AI extraction). */
  read(id: string): Promise<{ buffer: Buffer; mimeType: string } | null>;

  /** Public URL path for a given id, if known. */
  pathFor(id: string, ext: string): string;
}

const dataDir = path.resolve(process.env.POTLUCK_DATA_DIR ?? "./data");
const uploadsDir = path.join(dataDir, "uploads");

class DiskStorage implements Storage {
  constructor(private readonly root: string) {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  async put({ buffer, ext, mimeType }: { buffer: Buffer; ext: string; mimeType: string }) {
    const safeExt = sanitizeExt(ext, mimeType);
    const id = nanoid(16);
    const filename = `${id}.${safeExt}`;
    const absolutePath = path.join(this.root, filename);
    await fs.writeFile(absolutePath, buffer);
    return {
      id,
      publicPath: `/uploads/${filename}`,
      absolutePath,
    };
  }

  async delete(id: string) {
    const entries = await safeReaddir(this.root);
    const match = entries.find((f) => f.startsWith(`${id}.`));
    if (!match) return;
    await fs.unlink(path.join(this.root, match)).catch(() => {});
  }

  async read(id: string) {
    const entries = await safeReaddir(this.root);
    const match = entries.find((f) => f.startsWith(`${id}.`));
    if (!match) return null;
    const ext = match.slice(match.lastIndexOf(".") + 1);
    const buffer = await fs.readFile(path.join(this.root, match));
    return { buffer, mimeType: extToMime(ext) };
  }

  pathFor(id: string, ext: string) {
    return `/uploads/${id}.${sanitizeExt(ext)}`;
  }
}

function sanitizeExt(ext: string, mimeType?: string): string {
  const e = ext.replace(/^\./, "").toLowerCase();
  if (["jpg", "jpeg", "png", "webp", "avif", "heic", "gif"].includes(e)) return e;
  if (mimeType) {
    const fromMime = mimeType.split("/")[1]?.toLowerCase();
    if (fromMime && ["jpeg", "png", "webp", "avif", "heic", "gif"].includes(fromMime)) {
      return fromMime;
    }
  }
  return "bin";
}

function extToMime(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "avif") return "image/avif";
  if (e === "heic") return "image/heic";
  if (e === "gif") return "image/gif";
  return "application/octet-stream";
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export const storage: Storage = new DiskStorage(uploadsDir);

export const UPLOADS_DIR = uploadsDir;
