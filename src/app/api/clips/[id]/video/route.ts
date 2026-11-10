import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/access";
import { canViewClips, CLIP_ID, clipsApi, ClipsError } from "@/lib/clips";

// Streams one clip from the clip keeper, passing Range through so the player can seek.
// proxy.ts only checks that someone is signed in, so the access level is checked here.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/clips/[id]/video">) {
  const user = await currentUser();
  if (!canViewClips(user.level)) return new Response("Not allowed", { status: 403 });

  const { id } = await ctx.params;
  if (!CLIP_ID.test(id)) return new Response("Not found", { status: 404 });

  const range = request.headers.get("range");
  let upstream: Response;
  try {
    upstream = await clipsApi(`/api/clips/${encodeURIComponent(id)}/video`, {
      headers: range ? { Range: range } : {},
      signal: request.signal,
    });
  } catch (error) {
    const status = error instanceof ClipsError && error.message.includes("404") ? 404 : 502;
    return new Response(status === 404 ? "Not found" : "Clip storage unavailable", { status });
  }

  const headers = new Headers({ "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=300" });
  for (const name of ["Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
