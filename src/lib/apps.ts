import type { AccessLevel } from "./access";

export type Audience = "everyone" | "family" | "admin";

export type App = {
  id: string;
  name: string;
  description: string;
  url: string;
  category: string;
  audience: Audience;
  hidden: boolean;
};

const allowed: Record<AccessLevel, Audience[]> = {
  admin: ["everyone", "family", "admin"],
  family: ["everyone", "family"],
  limited: ["everyone"],
  none: [],
};

export function canSee(level: AccessLevel, audience: Audience) {
  return allowed[level].includes(audience);
}

// The server calls this before anything reaches the browser, so a tile that isn't
// shown is never sent.
export function visibleApps<T extends Pick<App, "audience" | "hidden">>(apps: T[], level: AccessLevel): T[] {
  return apps.filter((app) => !app.hidden && canSee(level, app.audience));
}
