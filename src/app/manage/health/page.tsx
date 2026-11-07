import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import { readClusterHealth, type ActiveAlert, type NodeHealth, type NodeWorkload } from "@/lib/cluster-health";
import { AutoRefresh } from "../../auto-refresh";
import { RefreshButton } from "./refresh-button";

const grafanaUrl = "https://grafana.energiapower.llc";
const longhornUrl = "https://longhorn.energiapower.llc";

function percent(value: number | null) {
  return value === null ? "No data" : `${Math.round(value * 100)}%`;
}

function Meter({ label, value }: { label: string; value: number | null }) {
  const high = value !== null && value >= 0.85;
  return (
    <span className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between gap-3">
        <span className="text-muted">{label}</span>
        <span className={high ? "text-(--down)" : undefined}>{percent(value)}</span>
      </span>
      <span className="block h-1.5 overflow-hidden rounded-full bg-foreground/10">
        <span
          className={`block h-full rounded-full ${high ? "bg-(--down)" : "bg-(--up)"}`}
          style={{ width: `${Math.min(100, (value ?? 0) * 100)}%` }}
        />
      </span>
    </span>
  );
}

function NodeCard({ node }: { node: NodeHealth }) {
  return (
    <li className="panel flex flex-col gap-3 p-4">
      <span className="flex items-center justify-between gap-3">
        <span className="font-medium">{node.name}</span>
        <span className={`flex items-center gap-2 text-sm ${node.ready ? "text-(--up)" : "text-(--down)"}`}>
          <span className={`status-dot ${node.ready ? "status-up" : "status-down"}`} aria-hidden="true" />
          {node.ready ? "Ready" : "Not ready"}
        </span>
      </span>
      <Meter label="CPU" value={node.cpu} />
      <Meter label="Memory" value={node.memory} />
      <Meter label="Longhorn disk" value={node.disk} />
    </li>
  );
}

function size(bytes: number | null) {
  if (bytes === null) return "No data";
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function WorkloadPanel({ node }: { node: NodeWorkload }) {
  return (
    <details className="panel px-5 py-3">
      <summary className="cursor-pointer">
        <span className="font-medium">{node.name}</span>
        <span className="text-muted text-sm">
          {` · ${size(node.memoryUsed)} of ${size(node.memoryTotal)} memory in use · ${node.pods.length} pods`}
        </span>
      </summary>
      <p className="text-muted py-2 text-sm">
        Outside pods: {size(node.outsidePods)} (k3s, etcd, containerd, the operating system and anything else
        installed on the machine).
      </p>
      <table className="w-full table-fixed text-sm">
        <thead className="text-muted text-left">
          <tr>
            <th scope="col" className="py-1 font-normal">
              Pod
            </th>
            <th scope="col" className="w-20 py-1 text-right font-normal">
              Memory
            </th>
            <th scope="col" className="w-16 py-1 text-right font-normal">
              CPU
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-foreground/10">
          {node.pods.map((pod) => (
            <tr key={`${pod.namespace}/${pod.pod}`}>
              <td className="truncate py-1" title={`${pod.namespace}/${pod.pod}`}>
                {pod.pod}
                <span className="text-muted"> · {pod.namespace}</span>
              </td>
              <td className="py-1 text-right">{size(pod.memory)}</td>
              <td className="py-1 text-right">{pod.cpu.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function AlertRow({ alert, now }: { alert: ActiveAlert; now: number }) {
  const minutes = Math.max(0, Math.floor((now - alert.since.getTime()) / 60_000));
  const age = minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h`;
  return (
    <li className="flex flex-col gap-1 py-3">
      <span className="flex flex-wrap justify-between gap-x-4">
        <span className="font-medium">{alert.name}</span>
        <span className="text-muted text-sm">
          <span className={alert.severity === "critical" ? "text-(--down)" : undefined}>{alert.severity}</span>
          {` · ${age}`}
        </span>
      </span>
      {alert.summary && <span className="text-muted text-sm">{alert.summary}</span>}
    </li>
  );
}

async function Health() {
  const user = await currentUser();
  if (user.level !== "admin") redirect("/");

  let health: Awaited<ReturnType<typeof readClusterHealth>>;
  try {
    health = await readClusterHealth();
  } catch (error) {
    console.error("Cluster health failed", error);
    return <p className="panel p-5 text-(--down)">Cluster health isn&apos;t available right now.</p>;
  }

  const now = health.checkedAt.getTime();
  return (
    <>
      <AutoRefresh seconds={30} />
      <RefreshButton checkedAt={health.checkedAt.toISOString()} />
      <section className="panel flex flex-col px-5 py-3">
        <h2 className="text-xl font-medium">Alerts</h2>
        {health.alerts.length === 0 ? (
          <p className="text-(--up) py-2">Nothing is firing.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-foreground/10">
            {health.alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} now={now} />
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Nodes</h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {health.nodes.map((node) => (
            <NodeCard key={node.name} node={node} />
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-medium">Inside each node</h2>
        <p className="text-muted text-sm">CPU is the number of cores in use, averaged over 5 minutes.</p>
        {health.workloads.map((node) => (
          <WorkloadPanel key={node.name} node={node} />
        ))}
      </section>
      <p className={health.unhealthyVolumes > 0 ? "panel p-5 text-(--down)" : "panel text-muted p-5"}>
        {health.unhealthyVolumes > 0
          ? `${health.unhealthyVolumes} Longhorn volume(s) degraded or faulted.`
          : "No Longhorn volumes are degraded or faulted."}
      </p>
      <section className="panel flex flex-wrap items-center gap-4 p-5">
        <span className="text-muted">Dig deeper:</span>
        <a href={grafanaUrl} className="underline">
          Grafana
        </a>
        <a href={longhornUrl} className="underline">
          Longhorn
        </a>
      </section>
    </>
  );
}

export default function HealthPage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Health</h1>
        <Link href="/manage" className="underline">
          Back to manage
        </Link>
      </header>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Health />
      </Suspense>
    </main>
  );
}
