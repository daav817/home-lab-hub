import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/access";
import { assertShare, canViewFiles, disposition, FilesError, inlineType, parsePath, webdavUrl } from "@/lib/files";

// Streams one router file for the viewer or as a download, passing Range through so videos
// can seek. proxy.ts only checks that someone is signed in; the access level is checked here.
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!canViewFiles(user.level)) return new Response("Not allowed", { status: 403 });

  const path = parsePath(request.nextUrl.searchParams.get("path") ?? "");
  if (!path || path.parts.length === 0) return new Response("Not found", { status: 404 });
  try {
    await assertShare(path.share);
  } catch (error) {
    return new Response(error instanceof FilesError ? error.message : "Unavailable", { status: error instanceof FilesError ? error.status : 502 });
  }

  const range = request.headers.get("range");
  const upstream = await fetch(webdavUrl(path), {
    headers: range ? { Range: range } : {},
    cache: "no-store",
    signal: request.signal,
  }).catch(() => null);
  if (!upstream) return new Response("Router files unavailable", { status: 502 });
  if (upstream.status === 404) return new Response("Not found", { status: 404 });
  if (!upstream.ok) return new Response("Router files unavailable", { status: 502 });

  const name = path.parts.at(-1)!;
  const inline = request.nextUrl.searchParams.get("download") !== "1" ? inlineType(name) : null;
  const headers = new Headers({
    "Content-Type": inline ?? "application/octet-stream",
    "Content-Disposition": disposition(inline ? "inline" : "attachment", name),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    // Even an inline file gets no script, forms or plugins.
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
  });
  for (const header of ["Content-Length", "Content-Range", "Last-Modified", "ETag"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
