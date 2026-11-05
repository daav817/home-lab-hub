import { getServerSession } from "next-auth";
import { connection } from "next/server";
import { authOptions } from "./auth";

export type AccessLevel = "admin" | "family" | "limited" | "none";

export function accessLevel(groups: string[]): AccessLevel {
  if (groups.includes("authentik Admins")) return "admin";
  if (groups.includes("hub-family")) return "family";
  if (groups.includes("hub-limited")) return "limited";
  return "none";
}

export async function currentUser() {
  // Rendering stops here at build time. The session read uses random values.
  await connection();
  const session = await getServerSession(authOptions);
  return {
    name: session?.user?.name ?? "",
    level: accessLevel(session?.groups ?? []),
  };
}

export function assertAdmin(level: AccessLevel) {
  if (level !== "admin") throw new Error("Admin access required");
}

// Server actions can be called directly, so each one starts here.
export async function requireAdmin() {
  const user = await currentUser();
  assertAdmin(user.level);
  return user;
}
