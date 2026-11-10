// Camera clips saved to the router by the clip keeper (platform/cameras/manifests/clip-keeper).
// The hub reads and changes them through the keeper's API, server-side only, with a token.

import type { AccessLevel } from "./access";

export type Clip = {
  id: string;
  camera: string;
  cameraName: string;
  start: number; // epoch seconds
  seconds: number;
  labels: string[];
  size: number;
  group: string | null;
};

export type ClipCamera = { id: string; name: string; on: boolean };

export type ClipStatus = {
  storage: string;
  used: number;
  count: number;
  limitGb: number;
  limitMinGb: number;
  limitMaxGb: number;
  away: boolean;
  schedule: boolean;
  recording: string;
  labels: string[];
  cameras: ClipCamera[];
};

export type ClipGroup = { name: string; count: number; bytes: number };

// A doorbell press. clip is null until the clip is saved (about 2 minutes after the press), or
// if the camera sent no video.
export type DoorbellPress = {
  camera: string;
  cameraName: string;
  pressed: number; // epoch seconds
  message: string;
  clip: string | null;
  seconds: number | null;
};

export class ClipsError extends Error {}

// Viewing matches Frigate (family and admins); changes are admin-only.
export function canViewClips(level: AccessLevel) {
  return level === "admin" || level === "family";
}

export const CLIP_ID = /^[A-Za-z0-9_.-]{1,120}$/;
export const GROUP_NAME = /^[\w .,'()&-]{1,60}$/;

export function cleanGroupName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  return GROUP_NAME.test(name) ? name : null;
}

export function gigabytes(bytes: number) {
  return `${(bytes / 1e9).toFixed(bytes < 10e9 ? 2 : 1)} GB`;
}

// Clips by local day, newest day first, keeping the order within each day.
export function byDay(clips: Clip[], dayOf: (start: number) => string) {
  const days: { day: string; clips: Clip[] }[] = [];
  for (const clip of clips) {
    const day = dayOf(clip.start);
    const last = days.at(-1);
    if (last && last.day === day) last.clips.push(clip);
    else days.push({ day, clips: [clip] });
  }
  return days;
}

export type ClipFilters = { camera?: string; group?: string; ungrouped?: boolean };

export function clipQuery(filters: ClipFilters, limit = 300) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (filters.camera) params.set("camera", filters.camera);
  if (filters.ungrouped) params.set("ungrouped", "1");
  else if (filters.group) params.set("group", filters.group);
  return params.toString();
}

// --- API calls (server only) ---

function apiBase() {
  const base = process.env.CLIPS_API_URL;
  const token = process.env.CLIPS_API_TOKEN;
  if (!base || !token) throw new ClipsError("The clip keeper isn't set up for the hub yet.");
  return { base, headers: { Authorization: `Bearer ${token}` } };
}

export async function clipsApi(path: string, init: RequestInit = {}): Promise<Response> {
  const { base, headers } = apiBase();
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...headers, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
      cache: "no-store",
    });
  } catch {
    throw new ClipsError("The clip keeper isn't answering.");
  }
  if (!response.ok && response.status !== 206) {
    throw new ClipsError(`The clip keeper answered ${response.status}.`);
  }
  return response;
}

export async function getClipStatus(): Promise<ClipStatus> {
  return (await clipsApi("/api/status")).json();
}

export async function listClips(filters: ClipFilters): Promise<Clip[]> {
  return (await clipsApi(`/api/clips?${clipQuery(filters)}`)).json();
}

export async function listDoorbellPresses(limit = 50): Promise<DoorbellPress[]> {
  return (await clipsApi(`/api/doorbell?limit=${limit}`)).json();
}

export async function listGroups(): Promise<ClipGroup[]> {
  return (await clipsApi("/api/groups")).json();
}

export async function deleteClips(ids: string[]): Promise<number> {
  const response = await clipsApi("/api/clips/delete", { method: "POST", body: JSON.stringify({ ids }) });
  return (await response.json()).deleted;
}

export async function groupClips(ids: string[], group: string | null): Promise<number> {
  const response = await clipsApi("/api/clips/group", { method: "POST", body: JSON.stringify({ ids, group }) });
  return (await response.json()).changed;
}

export async function saveClipSettings(settings: { limitGb?: number; away?: boolean; cameras?: Record<string, boolean> }) {
  return (await clipsApi("/api/settings", { method: "PUT", body: JSON.stringify(settings) })).json() as Promise<ClipStatus>;
}
