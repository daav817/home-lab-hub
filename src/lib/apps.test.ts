import { describe, expect, it } from "vitest";
import { visibleApps } from "./apps";

const apps = [
  { name: "Photos", audience: "everyone", hidden: false },
  { name: "CRM", audience: "family", hidden: false },
  { name: "ArgoCD", audience: "admin", hidden: false },
  { name: "Old", audience: "everyone", hidden: true },
] as const;

const names = (level: Parameters<typeof visibleApps>[1]) =>
  visibleApps([...apps], level).map((app) => app.name);

describe("visibleApps", () => {
  it("shows admins everything except hidden apps", () => {
    expect(names("admin")).toEqual(["Photos", "CRM", "ArgoCD"]);
  });

  it("keeps admin tools from family members", () => {
    expect(names("family")).toEqual(["Photos", "CRM"]);
  });

  it("never gives limited members business apps", () => {
    expect(names("limited")).toEqual(["Photos"]);
  });

  it("gives nothing to someone with no hub group", () => {
    expect(names("none")).toEqual([]);
  });
});
