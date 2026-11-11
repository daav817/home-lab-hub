// Router files (Phase 6). An rclone sidecar in the hub pod logs in to the router's SMB server
// as the hub's own router account and serves every share as one WebDAV tree on 127.0.0.1
// (downloads, uploads, renames) plus rclone's remote-control API (listings, free space,
// folders, deletes). Which shares appear is decided on the router: any share that account can
// open shows up here, except the ones in FILES_HIDDEN (the Longhorn backup share, the clips).
// Viewing is for family and admins; changes are admin-only and go in the audit log.

import type { AccessLevel } from "./access";

export class FilesError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function canViewFiles(level: AccessLevel) {
  return level === "admin" || level === "family";
}

// --- Paths -------------------------------------------------------------------------------

const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

// Deleted items wait in this folder at the top of their share (src/lib/trash.ts). It never
// appears in listings and can't be reached by any path from a URL or a form.
export const TRASH_FOLDER = ".hub-trash";

// One file or folder name as SMB accepts it: no separators or reserved characters, not "." or
// "..", no trailing dot or space (Windows can't open those), at most 255 characters.
export function cleanName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > 255 || name === "." || name === ".." || BAD_NAME.test(name) || /[. ]$/.test(name)) return null;
  if (name.toLowerCase() === TRASH_FOLDER) return null;
  return name;
}

export type FilePath = { share: string; parts: string[] };

// "photo/2024/Beach" -> { share: "photo", parts: ["2024", "Beach"] }, or null if any piece is
// unsafe. Every path from a URL or a form goes through here before it reaches rclone.
export function parsePath(raw: string | string[]): FilePath | null {
  const pieces = (Array.isArray(raw) ? raw : raw.split("/")).filter((p) => p !== "");
  if (pieces.length === 0) return null;
  // Rejected, or changed by cleaning (spaces at the ends): not a path we'd have made.
  if (pieces.some((p) => cleanName(p) !== p)) return null;
  const [share, ...parts] = pieces;
  return { share, parts };
}

export function joinPath(path: FilePath, ...more: string[]) {
  return [path.share, ...path.parts, ...more].join("/");
}

export function parentOf(path: FilePath): FilePath {
  return { share: path.share, parts: path.parts.slice(0, -1) };
}

// URL for a folder page (/files/photo/2024) or the raw file route.
export function folderHref(path: FilePath) {
  return "/files/" + [path.share, ...path.parts].map(encodeURIComponent).join("/");
}

export function rawHref(path: FilePath, download = false) {
  return `/api/files/raw?path=${encodeURIComponent(joinPath(path))}${download ? "&download=1" : ""}`;
}

export function hiddenShares(): Set<string> {
  return new Set(
    (process.env.FILES_HIDDEN ?? "k8s-storage-folder,camera-clips")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// --- What the browser may show inline ------------------------------------------------------

// Shown in the hub's viewer; everything else is downloaded. HTML, SVG and other active types
// are never served inline, so a file on the router can't run script on the hub's address.
const INLINE: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  bmp: "image/bmp", avif: "image/avif",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg",
  pdf: "application/pdf", txt: "text/plain; charset=utf-8",
};

export function extension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function inlineType(name: string): string | null {
  return INLINE[extension(name)] ?? null;
}

export type PreviewKind = "image" | "video" | "audio" | "pdf" | "text" | null;

export function previewKind(name: string): PreviewKind {
  const type = inlineType(name);
  if (!type) return null;
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  return "text";
}

// Content-Disposition with a plain fallback and the exact UTF-8 name (RFC 6266).
export function disposition(kind: "inline" | "attachment", name: string) {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `${kind}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

// --- Drives --------------------------------------------------------------------------------

export type ShareInfo = { name: string; total: number; used: number; free: number };
export type Drive = { shares: string[]; total: number; used: number; free: number };

// The router reports free space per share, and every share on one USB drive reports the same
// numbers, so shares are grouped into drives by them (read at the same moment).
export function groupDrives(shares: ShareInfo[]): Drive[] {
  const drives = new Map<string, Drive>();
  for (const s of shares) {
    if (!s.total) continue;
    const key = `${s.total}/${s.free}`;
    const drive = drives.get(key);
    if (drive) drive.shares.push(s.name);
    else drives.set(key, { shares: [s.name], total: s.total, used: s.used, free: s.free });
  }
  return [...drives.values()]
    .map((d) => ({ ...d, shares: d.shares.sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.shares[0].localeCompare(b.shares[0]));
}

export const DRIVE_WARN = 0.85;

export function driveRatio(drive: { total: number; used: number }) {
  return drive.total ? drive.used / drive.total : 0;
}

export function driveWarnings(drives: Drive[]) {
  return drives
    .filter((d) => driveRatio(d) >= DRIVE_WARN)
    .map((d) => `Router drive with ${d.shares.join(", ")} is ${Math.round(driveRatio(d) * 100)}% full.`);
}

// Prometheus text format for /api/metrics (scraped by the hub's ServiceMonitor).
export function driveMetrics(drives: Drive[], up: boolean) {
  const label = (d: Drive) => `{shares="${d.shares.join(",").replace(/["\\\n]/g, "_")}"}`;
  return [
    "# HELP hub_router_files_up 1 if the hub can read the router's shares.",
    "# TYPE hub_router_files_up gauge",
    `hub_router_files_up ${up ? 1 : 0}`,
    "# HELP hub_router_drive_size_bytes Size of a router drive (identified by its shares).",
    "# TYPE hub_router_drive_size_bytes gauge",
    ...drives.map((d) => `hub_router_drive_size_bytes${label(d)} ${d.total}`),
    "# HELP hub_router_drive_used_bytes Space used on a router drive.",
    "# TYPE hub_router_drive_used_bytes gauge",
    ...drives.map((d) => `hub_router_drive_used_bytes${label(d)} ${d.used}`),
    "",
  ].join("\n");
}

// --- Listings ------------------------------------------------------------------------------

export type Entry = { name: string; isDir: boolean; size: number; modified: string | null };

type RcItem = { Name: string; IsDir: boolean; Size: number; ModTime?: string };

export function toEntries(items: RcItem[]): Entry[] {
  return items
    .map((i) => ({
      name: i.Name,
      isDir: i.IsDir,
      size: i.IsDir ? 0 : Math.max(0, i.Size),
      // SMB folders have no useful time (rclone reports 2000-01-01 for shares)
      modified: i.ModTime && !i.ModTime.startsWith("2000-01-01") ? i.ModTime : null,
    }))
    .filter((e) => !e.name.startsWith("#recycle") && !e.name.startsWith("@") && e.name !== "desktop.ini" && e.name.toLowerCase() !== TRASH_FOLDER)
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export function formatBytes(bytes: number) {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

// --- rclone (server only) --------------------------------------------------------------------

function rcUrl() {
  return process.env.FILES_RC_URL ?? "http://127.0.0.1:5572";
}

export function webdavUrl(path: FilePath | string) {
  const base = process.env.FILES_WEBDAV_URL ?? "http://127.0.0.1:8091";
  const text = typeof path === "string" ? path : joinPath(path);
  return `${base}/${text.split("/").map(encodeURIComponent).join("/")}`;
}

async function rc<T>(command: string, body: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${rcUrl()}/${command}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new FilesError("The router file service isn't answering. Is the hub's router login set up?");
  }
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    const error = String(data.error ?? `HTTP ${response.status}`);
    if (/not found|doesn't exist|no such|object_name_not_found/i.test(error)) throw new FilesError("Not found.", 404);
    if (/access.?denied|permission/i.test(error)) throw new FilesError("The hub's router account can't open that.", 403);
    throw new FilesError(`The router said: ${error}`);
  }
  return data;
}

const remote = (path: FilePath | string) => `router:${typeof path === "string" ? path : joinPath(path)}`;

export async function listFolder(path: FilePath): Promise<Entry[]> {
  const data = await rc<{ list: RcItem[] }>("operations/list", { fs: remote(path.share), remote: path.parts.join("/"), opt: { noMimeType: true } });
  return toEntries(data.list ?? []);
}

export async function shareInfo(name: string): Promise<ShareInfo> {
  const about = await rc<{ total?: number; used?: number; free?: number }>("operations/about", { fs: remote(name) });
  return { name, total: about.total ?? 0, used: about.used ?? 0, free: about.free ?? 0 };
}

let shareCache: { at: number; shares: ShareInfo[] } | null = null;
let refreshing: Promise<ShareInfo[]> | null = null;

// Shares the hub's router account can open, with their drive's free space. The router takes
// about 11 s to refuse a share the account can't open, so the list is kept in memory: callers
// get the last list at once and an older-than-60-s list is refreshed in the background. Only
// the first call after a restart (or fresh = true) waits.
export async function listShares(fresh = false): Promise<ShareInfo[]> {
  if (!fresh && shareCache) {
    if (Date.now() - shareCache.at > 60_000 && !refreshing) {
      refreshing = readShares().catch(() => shareCache!.shares).finally(() => (refreshing = null));
    }
    return shareCache.shares;
  }
  refreshing ??= readShares().finally(() => (refreshing = null));
  return refreshing;
}

// Whether the router was read successfully in the last 15 minutes (a failed refresh keeps
// serving the old list, so this is what tells Prometheus the router is gone).
export function sharesFresh() {
  return shareCache !== null && Date.now() - shareCache.at < 15 * 60_000;
}

async function readShares(): Promise<ShareInfo[]> {
  const hidden = hiddenShares();
  const root = await rc<{ list: RcItem[] }>("operations/list", { fs: "router:", remote: "", opt: { dirsOnly: true, noMimeType: true } });
  const names = (root.list ?? []).map((i) => i.Name).filter((n) => !hidden.has(n.toLowerCase()));
  const results = await Promise.all(
    names.map(async (name) => {
      try {
        // The router lists every share's name; only the ones this account can open are kept.
        await rc("operations/list", { fs: remote(name), remote: "", opt: { noMimeType: true, noModTime: true } });
        return await shareInfo(name);
      } catch {
        return null;
      }
    }),
  );
  const shares = results.filter((s): s is ShareInfo => s !== null).sort((a, b) => a.name.localeCompare(b.name));
  shareCache = { at: Date.now(), shares };
  return shares;
}

export async function assertShare(share: string) {
  const shares = await listShares();
  if (!shares.some((s) => s.name === share)) throw new FilesError("Not found.", 404);
}

export async function makeFolder(path: FilePath) {
  await rc("operations/mkdir", { fs: remote(path.share), remote: path.parts.join("/") });
}

export async function deleteEntry(path: FilePath, isDir: boolean) {
  if (isDir) await rc("operations/purge", { fs: remote(path.share), remote: path.parts.join("/") });
  else await rc("operations/deletefile", { fs: remote(path.share), remote: path.parts.join("/") });
}

export async function exists(path: FilePath): Promise<boolean> {
  try {
    const result = await rc<{ item: unknown }>("operations/stat", { fs: remote(path.share), remote: path.parts.join("/") });
    return Boolean(result.item); // rclone answers { item: null } for a missing path
  } catch (error) {
    if (error instanceof FilesError && error.status === 404) return false;
    throw error;
  }
}

export async function removeEmptyFolder(path: FilePath) {
  await rc("operations/rmdir", { fs: remote(path.share), remote: path.parts.join("/") });
}

// Size in bytes of a file (folders report -1, so 0 here).
export async function fileSize(path: FilePath): Promise<number> {
  const result = await rc<{ item: { Size?: number; IsDir?: boolean } | null }>("operations/stat", { fs: remote(path.share), remote: path.parts.join("/") });
  return result.item && !result.item.IsDir ? Math.max(0, result.item.Size ?? 0) : 0;
}

// WebDAV MOVE renames and moves files and folders alike, within one share (the router does it
// in place, so even a large folder moves at once).
export async function rename(from: FilePath, to: FilePath) {
  const response = await fetch(webdavUrl(from), {
    method: "MOVE",
    headers: { Destination: webdavUrl(to), Overwrite: "F" },
    cache: "no-store",
  }).catch(() => null);
  if (!response) throw new FilesError("The router file service isn't answering.");
  if (response.status === 412) throw new FilesError("Something with that name is already there.", 409);
  if (!response.ok) throw new FilesError(`Rename failed (HTTP ${response.status}).`);
}
