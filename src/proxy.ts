import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

// Every page needs a session. The matcher below lists the few routes that stay open.
export async function proxy(request: NextRequest) {
  const token = await getToken({ req: request });
  if (token) return NextResponse.next();

  const signIn = new URL("/sign-in", process.env.NEXTAUTH_URL ?? request.url);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/((?!api/auth|api/health|sign-in|_next/static|_next/image|icon.svg|apple-icon.png|robots.txt).*)"],
};
