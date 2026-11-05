import { connection } from "next/server";
import { getHealth } from "@/lib/health";

// Answered per request so the probes check the running server, not a build-time copy.
export async function GET() {
  await connection();
  return Response.json(getHealth());
}
