export type AppStatus = "up" | "down" | "unknown";

// Any answer below 500 means the app is running. A 401 or a redirect to its login is normal.
export function classifyResponse(code: number): AppStatus {
  return code < 500 ? "up" : "down";
}

const cacheFor = 30_000;
const checked = new Map<string, { status: AppStatus; at: number }>();

export async function checkStatus(url: string | null): Promise<AppStatus> {
  if (!url) return "unknown";

  const cached = checked.get(url);
  if (cached && Date.now() - cached.at < cacheFor) return cached.status;

  let status: AppStatus;
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(3000) });
    status = classifyResponse(response.status);
  } catch {
    status = "down";
  }
  checked.set(url, { status, at: Date.now() });
  return status;
}
