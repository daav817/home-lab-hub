// Pod Security levels for every namespace (Phase 7). Kubernetes refuses to start a pod that
// breaks its namespace's "enforce" level, and logs/warns about "audit"/"warn" levels.
//
//   restricted  non-root, no privilege escalation, all capabilities dropped, seccomp on.
//   baseline    blocks the known dangerous settings (privileged, host network/PID, hostPath...).
//   privileged  anything goes: only where a pod needs the host by design (listed below).
//
// Each namespace enforces the strictest level its pods passed in a server-side dry run
// (2026-11-11), and warns/audits one level stricter so drift shows up in `kubectl` output and the
// API server's audit log. Run again after adding a namespace or changing a level:
//
//   node scripts/apply-pod-security.mjs            (dry run: shows what would break)
//   node scripts/apply-pod-security.mjs --apply

import { spawnSync } from "node:child_process";

const LEVELS = {
  // Pass restricted today.
  argocd: ["restricted", "restricted"],
  hub: ["restricted", "restricted"],
  traefik: ["restricted", "restricted"],
  // Pass baseline; restricted would need their images or manifests changed.
  authentik: ["baseline", "restricted"],
  default: ["baseline", "restricted"], // Petros, Energia
  "energia-web": ["baseline", "restricted"],
  godseye: ["baseline", "restricted"],
  investco: ["baseline", "restricted"],
  "pdf-edit": ["baseline", "restricted"],
  // Need the host by design, so privileged, but anything else that's not baseline is reported.
  "kube-system": ["privileged", "baseline"], // k3s system pods
  cameras: ["privileged", "baseline"], // Frigate and the Intel GPU plugin use /dev/dri and root
  "home-assistant": ["privileged", "baseline"], // host network for LAN discovery
  "longhorn-system": ["privileged", "baseline"], // storage driver: host disks and mounts
  monitoring: ["privileged", "baseline"], // node-exporter and promtail read the hosts
  "remote-access": ["privileged", "baseline"], // Wake-on-LAN relay on the host network
};
// calico-system, tigera-operator and metallb-system keep the labels their installers set.

const apply = process.argv.includes("--apply");
let problems = 0;

for (const [namespace, [enforce, report]] of Object.entries(LEVELS)) {
  const args = [
    "label", "namespace", namespace, "--overwrite",
    `pod-security.kubernetes.io/enforce=${enforce}`,
    `pod-security.kubernetes.io/warn=${report}`,
    `pod-security.kubernetes.io/audit=${report}`,
    ...(apply ? [] : ["--dry-run=server"]),
  ];
  // Warnings ("existing pods ... violate") come on stderr, also in a dry run.
  const run = spawnSync("kubectl", args, { encoding: "utf8" });
  if (run.status !== 0) {
    console.log(`${namespace.padEnd(16)} kubectl failed: ${run.stderr.trim()}`);
    problems++;
    continue;
  }
  const breaks = /violate/i.test(run.stderr);
  if (breaks) problems++;
  console.log(`${namespace.padEnd(16)} enforce=${enforce.padEnd(10)} warn/audit=${report.padEnd(10)} ${breaks ? "WOULD BLOCK EXISTING PODS" : "ok"}`);
}

console.log(apply ? "Applied." : "Dry run only. Add --apply to set the labels.");
if (problems) process.exitCode = 1;
