// Rules for router files that both the browser and the server use: what type a file is, the
// date it was taken (from its name when the phone put it there), and where the organizer puts
// photos and videos from the phone's upload folder. No server-only imports here.

import { extension, type FilePath } from "./files";

export type FileType = "photo" | "video" | "audio" | "document" | "other";

const TYPES: Record<Exclude<FileType, "other">, string[]> = {
  photo: ["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic", "heif", "avif", "tif", "tiff", "dng", "raw", "rw2", "cr2", "nef", "arw"],
  video: ["mp4", "m4v", "mov", "avi", "mkv", "mts", "m2ts", "mpg", "mpeg", "wmv", "3gp", "3g2", "webm"],
  audio: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "wma"],
  document: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "rtf", "odt", "csv", "htm", "html", "xml", "md"],
};

export function fileType(name: string): FileType {
  const ext = extension(name);
  for (const [type, list] of Object.entries(TYPES)) if (list.includes(ext)) return type as FileType;
  return "other";
}

// --- Organizer: which files move, and where -----------------------------------------------

export type MediaKind = "photo" | "video";

// Only these move from the upload folder (as asked): JPG/PNG/HEIC photos to Photos,
// MP4/AVI/MOV videos to Videos.
const ORGANIZE: Record<string, MediaKind> = {
  jpg: "photo", jpeg: "photo", png: "photo", heic: "photo", heif: "photo",
  mp4: "video", avi: "video", mov: "video",
};
export const ORGANIZE_TYPES = "JPG, PNG, HEIC, MP4, AVI or MOV";

export function mediaKind(name: string): MediaKind | null {
  return ORGANIZE[extension(name)] ?? null;
}

export type YearMonth = { year: number; month: number };

const ZONE = "America/New_York";

function zonedYearMonth(at: Date): YearMonth | null {
  if (Number.isNaN(at.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "numeric" }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return year && month ? { year, month } : null;
}

function plausible(date: YearMonth, day: number, now: Date) {
  if (date.month < 1 || date.month > 12 || day < 1 || day > 31 || date.year < 1990) return false;
  return new Date(date.year, date.month - 1, day).getTime() <= now.getTime() + 2 * 24 * 3600 * 1000;
}

// The month a photo or video was taken. Phone uploads are named for the moment they were taken
// (20251224_222810.mp4, VID_20200509_162207123.mp4, Screenshot_20240101_101010_App.jpg), which
// survives copying; the file's modified time is the fallback, and can be the upload time.
export function takenMonth(name: string, modified: string | null, now = new Date()): YearMonth | null {
  const stamp = /(?:^|[^0-9])((?:19|20)\d{2})(\d{2})(\d{2})[_-]\d{6}/.exec(name);
  if (stamp) {
    const date = { year: Number(stamp[1]), month: Number(stamp[2]) };
    if (plausible(date, Number(stamp[3]), now)) return date;
  }
  const epoch = /(?:^|[^0-9])(1[0-9]{12})(?:[^0-9]|$)/.exec(name); // dji_export_1700000000000.mp4
  if (epoch) {
    const at = new Date(Number(epoch[1]));
    if (at.getTime() <= now.getTime()) return zonedYearMonth(at);
  }
  return modified ? zonedYearMonth(new Date(modified)) : null;
}

export function monthFolder(date: YearMonth) {
  return `${date.year}-${String(date.month).padStart(2, "0")}`;
}

export type OrganizeConfig = { source: FilePath; photos: string; videos: string };

export function organizeConfig(env: Record<string, string | undefined> = process.env): OrganizeConfig {
  const source = (env.ORGANIZE_SOURCE ?? "Public_WD/uploaded media").split("/").filter(Boolean);
  return {
    source: { share: source[0] ?? "Public_WD", parts: source.slice(1) },
    photos: env.ORGANIZE_PHOTOS ?? "photo",
    videos: env.ORGANIZE_VIDEOS ?? "video",
  };
}

// Whether a folder is the upload folder or inside it.
export function inSource(folder: FilePath, config: OrganizeConfig) {
  return folder.share === config.source.share && config.source.parts.every((p, i) => folder.parts[i] === p);
}

// photo/2025/2025-12/20251224_222810.jpg, matching the year/year-month folders already there.
export function destination(name: string, kind: MediaKind, date: YearMonth, config: OrganizeConfig): FilePath {
  return { share: kind === "photo" ? config.photos : config.videos, parts: [String(date.year), monthFolder(date), name] };
}

export type PlanEntry = { name: string; isDir: boolean; size: number; modified: string | null };
export type Plan = {
  photos: number;
  videos: number;
  bytes: number;
  months: number;
  skipped: { name: string; reason: string }[];
};

// What a move of these entries would do, before anything is touched (shown for confirmation).
export function planMoves(entries: PlanEntry[], now = new Date()): Plan {
  const plan: Plan = { photos: 0, videos: 0, bytes: 0, months: 0, skipped: [] };
  const months = new Set<string>();
  for (const entry of entries) {
    const kind = entry.isDir ? null : mediaKind(entry.name);
    if (!kind) {
      plan.skipped.push({ name: entry.name, reason: entry.isDir ? "folder" : `not a ${ORGANIZE_TYPES}` });
      continue;
    }
    const date = takenMonth(entry.name, entry.modified, now);
    if (!date) {
      plan.skipped.push({ name: entry.name, reason: "no date" });
      continue;
    }
    plan[kind === "photo" ? "photos" : "videos"]++;
    plan.bytes += entry.size;
    months.add(`${kind}/${monthFolder(date)}`);
  }
  plan.months = months.size;
  return plan;
}

// --- Tidying photo and video: loose files in a year folder go into its month folders --------

const YEAR = /^\d{4}$/;

// A photo or video lying straight in a year folder of the photo or video share (photo/2023/x.jpg).
// Named folders (photo/Gallery Wall, video/movies, photo/2019/Preschool_Pics) are never touched.
export function isLoose(path: FilePath, config: OrganizeConfig) {
  if (path.share !== config.photos && path.share !== config.videos) return false;
  if (path.parts.length !== 2 || !YEAR.test(path.parts[0])) return false;
  const type = fileType(path.parts[1]);
  return type === "photo" || type === "video";
}

// Where a loose file goes: the month folder inside the year folder it's already in. A file
// whose date is in another year (a camera with a wrong clock, a later copy) stays put.
export function tidyTarget(path: FilePath, modified: string | null, config: OrganizeConfig, now = new Date()): { to: FilePath } | { skip: string } | null {
  if (!isLoose(path, config)) return null;
  const [year, name] = path.parts;
  const date = takenMonth(name, modified, now);
  if (!date) return { skip: "no date" };
  if (String(date.year) !== year) return { skip: `dated ${monthFolder(date)}, not ${year}; left in the year folder` };
  return { to: { share: path.share, parts: [year, monthFolder(date), name] } };
}
