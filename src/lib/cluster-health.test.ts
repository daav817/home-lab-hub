import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNodes, healthWarning, toActiveAlerts, type RawAlert } from "./cluster-health";

const sample = (metric: Record<string, string>, value: string) => ({
  metric,
  value: [0, value] as [number, string],
});

function alert(name: string, severity: string, startsAt = "2026-11-06T12:00:00Z"): RawAlert {
  return {
    fingerprint: `${name}-${startsAt}`,
    startsAt,
    labels: { alertname: name, severity },
    annotations: { summary: `${name} summary` },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildNodes", () => {
  const info = [
    sample({ node: "worker-01", internal_ip: "192.168.1.101" }, "1"),
    sample({ node: "openclaw", internal_ip: "192.168.1.100" }, "1"),
  ];

  it("links metrics reported by IP to node names, sorted by name", () => {
    const nodes = buildNodes(
      info,
      [sample({ node: "openclaw" }, "1"), sample({ node: "worker-01" }, "1")],
      [sample({ instance: "192.168.1.100:9100" }, "0.25")],
      [sample({ instance: "192.168.1.101:9100" }, "0.5")],
      [sample({ node: "openclaw" }, "0.58")],
    );

    expect(nodes).toEqual([
      { name: "openclaw", ready: true, cpu: 0.25, memory: null, disk: 0.58 },
      { name: "worker-01", ready: true, cpu: null, memory: 0.5, disk: null },
    ]);
  });

  it("marks a node with no ready signal as not ready", () => {
    const [node] = buildNodes(info, [sample({ node: "openclaw" }, "0")], [], [], []);
    expect(node.ready).toBe(false);
  });
});

describe("toActiveAlerts", () => {
  it("drops heartbeats and puts critical alerts first", () => {
    const alerts = toActiveAlerts([
      alert("Watchdog", "none"),
      alert("InfoInhibitor", "none"),
      alert("DiskFull", "warning"),
      alert("NodeDown", "critical"),
    ]);
    expect(alerts.map((entry) => entry.name)).toEqual(["NodeDown", "DiskFull"]);
  });

  it("puts newer alerts first within a severity", () => {
    const alerts = toActiveAlerts([
      alert("Older", "warning", "2026-11-06T10:00:00Z"),
      alert("Newer", "warning", "2026-11-06T11:00:00Z"),
    ]);
    expect(alerts.map((entry) => entry.name)).toEqual(["Newer", "Older"]);
  });
});

describe("healthWarning", () => {
  it("stays quiet when only heartbeats are firing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([alert("Watchdog", "none")]))));
    await expect(healthWarning()).resolves.toBeNull();
  });

  it("counts real alerts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([alert("NodeDown", "critical")]))));
    await expect(healthWarning()).resolves.toBe("1 alert is firing.");
  });

  it("says so when alerts can't be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(healthWarning()).resolves.toBe("Cluster alerts aren't available right now.");
  });
});
