import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { driveMetrics, groupDrives, listShares, sharesFresh } from "@/lib/files";

// Router drive usage for Prometheus (k8s/monitoring.yaml scrapes it and alerts at 85%).
// Open in proxy.ts so Prometheus needs no session; a bearer token guards it instead.
export async function GET(request: Request) {
  await connection();
  const token = process.env.METRICS_TOKEN ?? "";
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  if (!token || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: string;
  try {
    const drives = groupDrives(await listShares());
    body = driveMetrics(drives, sharesFresh());
  } catch {
    body = driveMetrics([], false);
  }
  return new Response(body, { headers: { "Content-Type": "text/plain; version=0.0.4" } });
}
