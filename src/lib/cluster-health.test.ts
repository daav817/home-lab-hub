import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNodes, buildWorkloads, healthWarning, toActiveAlerts, type RawAlert } from "./cluster-health";

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

describe("buildWorkloads", () => {
  const info = [sample({ node: "openclaw", internal_ip: "192.168.1.100" }, "1")];
  const total = [sample({ instance: "192.168.1.100:9100" }, "8000")];
  const available = [sample({ instance: "192.168.1.100:9100" }, "2000")];
  const pod = (node: string, name: string, value: string) => sample({ node, namespace: "apps", pod: name }, value);

  it("lists a node's pods by memory and works out what's outside them", () => {
    const [node] = buildWorkloads(
      info,
      total,
      available,
      [pod("openclaw", "small", "1000"), pod("openclaw", "big", "3000"), pod("worker-01", "other", "500")],
      [pod("openclaw", "big", "0.25")],
    );

    expect(node).toEqual({
      name: "openclaw",
      memoryTotal: 8000,
      memoryUsed: 6000,
      outsidePods: 2000,
      pods: [
        { namespace: "apps", pod: "big", memory: 3000, cpu: 0.25 },
        { namespace: "apps", pod: "small", memory: 1000, cpu: 0 },
      ],
    });
  });

  it("never reports negative memory outside pods", () => {
    const [node] = buildWorkloads(info, total, available, [pod("openclaw", "big", "7000")], []);
    expect(node.outsidePods).toBe(0);
  });

  it("reports no data when node memory is missing", () => {
    const [node] = buildWorkloads(info, [], [], [], []);
    expect(node.memoryUsed).toBeNull();
    expect(node.outsidePods).toBeNull();
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
