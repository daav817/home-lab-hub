// Uploads to the router arrive in pieces: Cloudflare refuses requests over 100 MB, and the
// hub's proxy.ts keeps at most 10 MB of a request body (it silently cuts the rest). Each piece
// is appended to a staging file on the pod's disk; after the last piece the whole file is sent
// to the router in one stream and the staging file is removed.

import { createReadStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { exists, FilesError, joinPath, webdavUrl, type FilePath } from "./files";

export const CHUNK_BYTES = 8 * 1024 * 1024; // below proxy.ts's 10 MB body limit
export const MAX_UPLOAD_BYTES = 10 * 1024 ** 3; // the staging volume's size limit
const STALE_MS = 24 * 3600 * 1000;
export const UPLOAD_ID = /^[a-f0-9-]{36}$/;

export type UploadMeta = { target: string; total: number; actor: string };

// Whether a piece fits: it must start where the staging file ends, not run past the total,
// and (except the last) be a full piece. Returns an error message or null.
export function checkChunk(p: { offset: number; length: number; total: number; staged: number }): string | null {
  if (!Number.isSafeInteger(p.total) || p.total < 0 || p.total > MAX_UPLOAD_BYTES) return "File too large (10 GB at most).";
  if (p.offset !== p.staged) return "out-of-order";
  if (p.length > CHUNK_BYTES) return "Piece too large.";
  if (p.offset + p.length > p.total) return "Piece runs past the end of the file.";
  if (p.offset + p.length < p.total && p.length !== CHUNK_BYTES) return "Piece too small.";
  return null;
}

function stagingDir() {
  return process.env.FILES_STAGING ?? "/staging";
}

async function sweep(dir: string) {
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const file = join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && Date.now() - info.mtimeMs > STALE_MS) await rm(file, { force: true });
  }
}

export type ChunkResult = { received: number; done: boolean };

export async function receiveChunk(opts: {
  id: string;
  target: FilePath;
  offset: number;
  total: number;
  body: Uint8Array;
  actor: string;
}): Promise<ChunkResult> {
  const dir = stagingDir();
  await mkdir(dir, { recursive: true });
  const part = join(dir, `${opts.id}.part`);
  const metaFile = join(dir, `${opts.id}.json`);
  const target = joinPath(opts.target);

  if (opts.offset === 0) {
    await sweep(dir);
    if (await exists(opts.target)) throw new FilesError("A file with that name is already there.", 409);
    await rm(part, { force: true });
    const meta: UploadMeta = { target, total: opts.total, actor: opts.actor };
    await writeFile(metaFile, JSON.stringify(meta));
  }
  const meta = JSON.parse(await readFile(metaFile, "utf8").catch(() => "null")) as UploadMeta | null;
  if (!meta || meta.target !== target || meta.total !== opts.total || meta.actor !== opts.actor) {
    throw new FilesError("Unknown upload; start it again.", 409);
  }
  const staged = (await stat(part).catch(() => null))?.size ?? 0;
  const problem = checkChunk({ offset: opts.offset, length: opts.body.byteLength, total: opts.total, staged });
  if (problem === "out-of-order") return { received: staged, done: false }; // the browser resends from here
  if (problem) throw new FilesError(problem, 400);

  await appendFile(part, opts.body);
  const received = staged + opts.body.byteLength;
  if (received < opts.total) return { received, done: false };

  try {
    const response = await fetch(webdavUrl(target), {
      method: "PUT",
      body: Readable.toWeb(createReadStream(part)) as ReadableStream,
      headers: { "Content-Length": String(opts.total) },
      // Node's fetch needs this for a streamed body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) throw new FilesError(`The router refused the file (HTTP ${response.status}).`);
  } finally {
    await rm(part, { force: true });
    await rm(metaFile, { force: true });
  }
  return { received, done: true };
}
