"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ClipStatus } from "@/lib/clips";
import type { ClipActionState } from "./actions";

type Settings = { limitGb: number; away: boolean; cameras: Record<string, boolean> };

// Admin settings: which cameras save clips (cameras added to Frigate appear here, off), the
// storage limit, and the Away switch. The same settings are in Home Assistant.
export function ClipSettings({ status, action }: { status: ClipStatus; action: (s: Settings) => Promise<ClipActionState> }) {
  const router = useRouter();
  const [limitGb, setLimitGb] = useState(status.limitGb);
  const [away, setAway] = useState(status.away);
  const [cameras, setCameras] = useState<Record<string, boolean>>(Object.fromEntries(status.cameras.map((c) => [c.id, c.on])));
  const [message, setMessage] = useState<ClipActionState>({});
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await action({ limitGb, away, cameras });
      setMessage(result);
      if (!result.error) router.refresh();
    });

  return (
    <section className="panel flex flex-col gap-4 p-5">
      <h2 className="text-xl font-medium">Settings</h2>
      <label className="flex items-center gap-3">
        <input type="checkbox" checked={away} onChange={(e) => setAway(e.target.checked)} />
        <span>
          Away: record now <span className="text-muted text-sm">(the schedule is set in Home Assistant)</span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Cameras that save clips</legend>
        {status.cameras.map((camera) => (
          <label key={camera.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={cameras[camera.id] ?? false}
              onChange={(e) => setCameras({ ...cameras, [camera.id]: e.target.checked })}
            />
            {camera.name}
          </label>
        ))}
        <p className="text-muted text-sm">
          New cameras added to Frigate show up here switched off. Battery Blink cameras only record while someone is
          watching them live.
        </p>
      </fieldset>
      <label className="flex flex-col gap-2">
        <span>
          Storage limit: <span className="font-medium">{limitGb} GB</span>
        </span>
        <input
          type="range"
          min={status.limitMinGb}
          max={status.limitMaxGb}
          step={50}
          value={limitGb}
          onChange={(e) => setLimitGb(Number(e.target.value))}
          aria-label="Storage limit in GB"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
        {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
      </div>
    </section>
  );
}
