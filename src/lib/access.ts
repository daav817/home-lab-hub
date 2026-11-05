export type AccessLevel = "admin" | "family" | "limited" | "none";

export function accessLevel(groups: string[]): AccessLevel {
  if (groups.includes("authentik Admins")) return "admin";
  if (groups.includes("hub-family")) return "family";
  if (groups.includes("hub-limited")) return "limited";
  return "none";
}
