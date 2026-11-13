import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/access";
import { busy, convert, plan, probeVideo } from "@/lib/convert";
import { assertShare, canViewFiles, convertKind, disposition, FilesError, parsePath, webdavUrl } from "@/lib/files";

// Plays a router file browsers can't (WMA, AVI, MTS, ...) by converting it while it streams
// (src/lib/convert.ts). Same access rule as /api/files/raw: family and admins.
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!canViewFiles(user.level)) return new Response("Not allowed", { status: 403 });

  const path = parsePath(request.nextUrl.searchParams.get("path") ?? "");
  const name = path?.parts.at(-1);
  const kind = name ? convertKind(name) : null;
  if (!path || !name || !kind) return new Response("Not found", { status: 404 });
  try {
    await assertShare(path.share);
  } catch (error) {
    return new Response(error instanceof FilesError ? error.message : "Unavailable", { status: error instanceof FilesError ? error.status : 502 });
  }
  if (busy()) return new Response("Two files are already being converted. Try again in a moment.", { status: 503, headers: { "Retry-After": "10" } });

  const input = webdavUrl(path);
  const video = kind === "video" ? await probeVideo(input) : null;
  if (kind === "video" && !video) return new Response("That file couldn't be read as a video.", { status: 415 });
  const { contentType, args } = plan(kind, input, video);

  return new Response(convert(args, request.signal), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition("inline", name.replace(/\.[^.]+$/, kind === "audio" ? ".mp3" : ".mp4")),
      "Cache-Control": "no-store",
      "Content-Security-Policy": "sandbox; default-src 'none'; media-src 'self'",
    },
  });
}
