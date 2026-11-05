import { Suspense } from "react";
import type { ManagedApp } from "@/lib/db";
import { checkStatus, type AppStatus } from "@/lib/status";

const accents = ["--cyan", "--violet", "--magenta", "--lime", "--amber"];

const statusText: Record<AppStatus | "checking", string> = {
  up: "Online",
  down: "Offline",
  unknown: "Not monitored",
  checking: "Checking",
};

function StatusDot({ status }: { status: AppStatus | "checking" }) {
  const tone = status === "up" ? "status-up" : status === "down" ? "status-down" : "";
  return (
    <span className="text-muted flex items-center gap-2 text-xs">
      <span className={`status-dot ${tone}`} aria-hidden="true" />
      {statusText[status]}
    </span>
  );
}

async function LiveStatus({ url }: { url: string | null }) {
  return <StatusDot status={await checkStatus(url)} />;
}

export function AppTile({ app, index }: { app: ManagedApp; index: number }) {
  return (
    <a
      href={app.url}
      className="tile panel"
      style={{ "--accent": `var(${accents[index % accents.length]})` } as React.CSSProperties}
    >
      <span className="monogram" aria-hidden="true">
        {app.name.slice(0, 2)}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold">{app.name}</span>
        {app.description && <span className="text-muted text-sm">{app.description}</span>}
        <Suspense fallback={<StatusDot status="checking" />}>
          <LiveStatus url={app.statusUrl} />
        </Suspense>
      </span>
    </a>
  );
}
