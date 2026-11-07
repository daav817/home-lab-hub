const prometheus =
  process.env.PROMETHEUS_URL ?? "http://kube-prometheus-stack-prometheus.monitoring.svc.cluster.local:9090";
const alertmanager =
  process.env.ALERTMANAGER_URL ?? "http://kube-prometheus-stack-alertmanager.monitoring.svc.cluster.local:9093";

// Alertmanager's own heartbeats. These fire all the time on purpose.
const ignored = ["Watchdog", "InfoInhibitor"];

type Sample = { metric: Record<string, string>; value: [number, string] };

export type NodeHealth = {
  name: string;
  ready: boolean;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
};

export type PodUsage = { namespace: string; pod: string; memory: number; cpu: number };

export type NodeWorkload = {
  name: string;
  memoryTotal: number | null;
  memoryUsed: number | null;
  // Memory in use by anything that isn't a pod, such as k3s, etcd, containerd and the OS.
  outsidePods: number | null;
  pods: PodUsage[];
};

export type ActiveAlert = { id: string; name: string; severity: string; summary: string; since: Date };

export type RawAlert = {
  fingerprint: string;
  startsAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
};

async function query(promql: string): Promise<Sample[]> {
  const response = await fetch(`${prometheus}/api/v1/query?query=${encodeURIComponent(promql)}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Prometheus answered ${response.status}`);
  const body = (await response.json()) as { data: { result: Sample[] } };
  return body.data.result;
}

function byLabel(samples: Sample[], label: string) {
  return new Map(samples.map((sample) => [sample.metric[label], Number(sample.value[1])]));
}

// Node exporter reports node IPs, so kube_node_info links them to node names.
export function buildNodes(
  info: Sample[],
  ready: Sample[],
  cpu: Sample[],
  memory: Sample[],
  disk: Sample[],
): NodeHealth[] {
  const readyByNode = byLabel(ready, "node");
  const cpuByInstance = byLabel(cpu, "instance");
  const memoryByInstance = byLabel(memory, "instance");
  const diskByNode = byLabel(disk, "node");

  return info
    .map(({ metric }) => {
      const instance = `${metric.internal_ip}:9100`;
      return {
        name: metric.node,
        ready: readyByNode.get(metric.node) === 1,
        cpu: cpuByInstance.get(instance) ?? null,
        memory: memoryByInstance.get(instance) ?? null,
        disk: diskByNode.get(metric.node) ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Container metrics carry the node's name. Memory figures come from node exporter, by IP.
export function buildWorkloads(
  info: Sample[],
  memoryTotal: Sample[],
  memoryAvailable: Sample[],
  podMemory: Sample[],
  podCpu: Sample[],
): NodeWorkload[] {
  const totalByInstance = byLabel(memoryTotal, "instance");
  const availableByInstance = byLabel(memoryAvailable, "instance");
  const key = ({ metric }: Sample) => `${metric.node}/${metric.namespace}/${metric.pod}`;
  const cpuByPod = new Map(podCpu.map((sample) => [key(sample), Number(sample.value[1])]));

  return info
    .map(({ metric }) => {
      const instance = `${metric.internal_ip}:9100`;
      const total = totalByInstance.get(instance) ?? null;
      const available = availableByInstance.get(instance) ?? null;
      const used = total !== null && available !== null ? total - available : null;
      const pods = podMemory
        .filter((sample) => sample.metric.node === metric.node)
        .map((sample) => ({
          namespace: sample.metric.namespace,
          pod: sample.metric.pod,
          memory: Number(sample.value[1]),
          cpu: cpuByPod.get(key(sample)) ?? 0,
        }))
        .sort((a, b) => b.memory - a.memory);
      const inPods = pods.reduce((sum, pod) => sum + pod.memory, 0);

      return {
        name: metric.node,
        memoryTotal: total,
        memoryUsed: used,
        outsidePods: used === null ? null : Math.max(0, used - inPods),
        pods,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const severityOrder = ["critical", "warning", "info"];

export function toActiveAlerts(alerts: RawAlert[]): ActiveAlert[] {
  const rank = (severity: string) => {
    const index = severityOrder.indexOf(severity);
    return index === -1 ? severityOrder.length : index;
  };

  return alerts
    .filter((alert) => !ignored.includes(alert.labels.alertname))
    .map((alert) => ({
      id: alert.fingerprint,
      name: alert.labels.alertname,
      severity: alert.labels.severity ?? "none",
      summary: alert.annotations.summary ?? alert.annotations.description ?? "",
      since: new Date(alert.startsAt),
    }))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.since.getTime() - a.since.getTime());
}

export async function readAlerts() {
  const response = await fetch(`${alertmanager}/api/v2/alerts?active=true&silenced=false&inhibited=false`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Alertmanager answered ${response.status}`);
  return toActiveAlerts((await response.json()) as RawAlert[]);
}

export async function readClusterHealth() {
  const [info, ready, cpu, memory, disk, unhealthy, memoryTotal, memoryAvailable, podMemory, podCpu, alerts] =
    await Promise.all([
      query("kube_node_info"),
      query('kube_node_status_condition{condition="Ready",status="true"}'),
      query("instance:node_cpu_utilisation:rate5m"),
      query("instance:node_memory_utilisation:ratio"),
      query("max by (node) (longhorn_disk_usage_bytes / longhorn_disk_capacity_bytes)"),
      query("count(max by (volume) (longhorn_volume_robustness) >= 2)"),
      query("node_memory_MemTotal_bytes"),
      query("node_memory_MemAvailable_bytes"),
      query('sum by (node, namespace, pod) (container_memory_working_set_bytes{container!="",container!="POD"})'),
      query('sum by (node, namespace, pod) (rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[5m]))'),
      readAlerts(),
    ]);

  return {
    nodes: buildNodes(info, ready, cpu, memory, disk),
    workloads: buildWorkloads(info, memoryTotal, memoryAvailable, podMemory, podCpu),
    unhealthyVolumes: unhealthy.length > 0 ? Number(unhealthy[0].value[1]) : 0,
    alerts,
    checkedAt: new Date(),
  };
}

// Shown on the home page, so a problem is seen without opening the Health page.
export async function healthWarning(): Promise<string | null> {
  try {
    const alerts = await readAlerts();
    if (alerts.length === 0) return null;
    return `${alerts.length} alert${alerts.length === 1 ? " is" : "s are"} firing.`;
  } catch {
    return "Cluster alerts aren't available right now.";
  }
}
