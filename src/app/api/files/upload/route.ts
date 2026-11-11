import type { NextRequest } from "next/server";
import { currentUser } from "@/lib/access";
import { recordAudit } from "@/lib/db";
import { assertShare, cleanName, FilesError, joinPath, parsePath } from "@/lib/files";
import { receiveChunk, UPLOAD_ID } from "@/lib/uploads";

// One piece of an upload (admins only). Headers say where it belongs; the body is the bytes.
// Answers { received, done } so the browser knows where to continue.
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (user.level !== "admin") return Response.json({ error: "Only admins can upload." }, { status: 403 });

  const h = request.headers;
  const id = h.get("x-upload-id") ?? "";
  const folder = parsePath(decodeURIComponent(h.get("x-upload-folder") ?? ""));
  const name = cleanName(decodeURIComponent(h.get("x-upload-name") ?? ""));
  const offset = Number(h.get("x-upload-offset"));
  const total = Number(h.get("x-upload-total"));
  const declared = Number(h.get("x-chunk-length"));
  if (!UPLOAD_ID.test(id) || !folder || !name || !Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || !Number.isSafeInteger(declared)) {
    return Response.json({ error: "Bad upload request." }, { status: 400 });
  }

  const body = new Uint8Array(await request.arrayBuffer());
  // proxy.ts cuts bodies over its limit without an error, so a short piece is caught here.
  if (body.byteLength !== declared) {
    return Response.json({ error: `Piece arrived cut short (${body.byteLength} of ${declared} bytes).` }, { status: 400 });
  }

  const target = { share: folder.share, parts: [...folder.parts, name] };
  try {
    await assertShare(folder.share);
    const result = await receiveChunk({ id, target, offset, total, body, actor: user.name });
    if (result.done) await recordAudit(user.name, "files.upload", joinPath(target), { bytes: total });
    return Response.json(result);
  } catch (error) {
    if (error instanceof FilesError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Upload failed", error);
    return Response.json({ error: "Upload failed." }, { status: 500 });
  }
}
