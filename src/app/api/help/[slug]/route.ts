import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/access";
import { findHelpDoc } from "@/lib/help-docs";

// Serves a Help PDF to users allowed to see it. Shown inside the Help panel, so this path may
// be framed by the hub itself (next.config.ts exempts it from X-Frame-Options: DENY).
// ?download=1 saves it instead of opening it.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/help/[slug]">) {
  const user = await currentUser();
  const { slug } = await ctx.params;
  const doc = findHelpDoc(slug, user.level);
  if (!doc) return new Response("Not found", { status: 404 });

  let pdf: Buffer;
  try {
    pdf = await readFile(join(process.cwd(), "help", doc.file));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = `Home Lab Hub - ${doc.title.replace(/[^\w &.-]/g, "")}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Frame-Options": "SAMEORIGIN",
      "Content-Security-Policy": "frame-ancestors 'self'",
    },
  });
}
