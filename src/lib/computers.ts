// Home PCs that can be woken from the hub (Manage > Computers). The wake itself is sent by the
// Wake-on-LAN relay on worker-01 (platform/remote-access/manifests/wol-relay.yaml), because only
// the host network reaches the home LAN. Remote desktop itself is MeshCentral (MESH_URL).

import { sql } from "./db";

export type Computer = { id: string; name: string; mac: string; note: string };

export class WakeError extends Error {}

// "AA-BB-CC-dd-ee-ff", "aabb.ccdd.eeff" or "aabbccddeeff" -> "aa:bb:cc:dd:ee:ff"; null if not a MAC.
export function normalizeMac(raw: string): string | null {
  const hex = raw.trim().toLowerCase().replace(/[\s:.-]/g, "");
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  if (hex === "000000000000" || hex === "ffffffffffff") return null;
  return hex.match(/../g)!.join(":");
}

export async function listComputers(): Promise<Computer[]> {
  return sql<Computer[]>`select id, name, mac, note from computers order by name`;
}

export async function findComputer(id: string): Promise<Computer | undefined> {
  const [row] = await sql<Computer[]>`select id, name, mac, note from computers where id = ${id}`;
  return row;
}

export async function addComputer(input: { name: string; mac: string; note: string }) {
  await sql`insert into computers (name, mac, note) values (${input.name}, ${input.mac}, ${input.note})`;
}

export async function removeComputer(id: string) {
  await sql`delete from computers where id = ${id}`;
}

export function meshUrl() {
  return process.env.MESH_URL ?? "https://mesh.energiapower.llc";
}

export async function wake(mac: string) {
  const url = process.env.WOL_URL;
  const token = process.env.WOL_TOKEN;
  if (!url || !token) throw new WakeError("Wake-on-LAN isn't set up yet (no relay token).");
  const response = await fetch(`${url}/wake`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ mac }),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response) throw new WakeError("The Wake-on-LAN relay isn't answering.");
  if (!response.ok) throw new WakeError(`The Wake-on-LAN relay refused (HTTP ${response.status}).`);
}
