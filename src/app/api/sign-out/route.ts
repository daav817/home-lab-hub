import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { authentikSignOutUrl } from "@/lib/sign-out";

// Where to send the browser after the hub's own cookie is cleared. Read before signing out,
// while the session (and its ID token) still exists.
export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  const issuer = process.env.AUTHENTIK_ISSUER;
  const hub = process.env.NEXTAUTH_URL;
  if (!issuer || !hub) return Response.json({ url: null });
  return Response.json({ url: authentikSignOutUrl(issuer, hub, token?.idToken) });
}
