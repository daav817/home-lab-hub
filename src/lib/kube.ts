import { readFile } from "node:fs/promises";

const tokenFile = "/var/run/secrets/kubernetes.io/serviceaccount/token";

// Tokens rotate about hourly, so this reads the file every time. `kubectl proxy` needs none.
async function authHeader(): Promise<Record<string, string>> {
  try {
    return { Authorization: `Bearer ${(await readFile(tokenFile, "utf8")).trim()}` };
  } catch {
    return {};
  }
}

export async function kube<T>(path: string, body?: object): Promise<T> {
  const base = process.env.KUBE_API_URL ?? "https://kubernetes.default.svc";
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Kubernetes answered ${response.status} for ${path}`);
  return response.json() as Promise<T>;
}
