"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { byDay, type Clip } from "@/lib/clips";
import type { ClipActionState } from "./actions";

const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

type Props = {
  clips: Clip[];
  groups: string[];
  canManage: boolean;
  deleteAction: (ids: string[]) => Promise<ClipActionState>;
  groupAction: (ids: string[], group: string | null) => Promise<ClipActionState>;
};

export function ClipLibrary({ clips, groups, canManage, deleteAction, groupAction }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<Clip | null>(null);
  const [groupName, setGroupName] = useState("");
  const [message, setMessage] = useState<ClipActionState>({});
  const [pending, startTransition] = useTransition();

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (action: () => Promise<ClipActionState>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      if (!result.error) {
        setSelected(new Set());
        if (playing && !clips.some((c) => c.id === playing.id)) setPlaying(null);
        router.refresh();
      }
    });

  const ids = [...selected];

  if (clips.length === 0) {
    return <p className="panel text-muted px-5 py-4">No clips here yet.</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      {playing && (
        <div className="panel flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-medium">
              {playing.cameraName} · {timeFormat.format(playing.start * 1000)} · {playing.labels.join(", ")}
            </span>
            <button type="button" className="underline" onClick={() => setPlaying(null)}>
              Close
            </button>
          </div>
          {/* key: a new clip gets a fresh player */}
          <video key={playing.id} src={`/api/clips/${encodeURIComponent(playing.id)}/video`} controls autoPlay playsInline className="w-full rounded" />
        </div>
      )}

      {canManage && (
        <div className="panel sticky top-2 z-10 flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="text-muted text-sm">{selected.size} selected</span>
          <button type="button" className="underline text-sm" onClick={() => setSelected(new Set(clips.map((c) => c.id)))}>
            Select all shown
          </button>
          <button type="button" className="underline text-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <span className="flex items-center gap-2">
            <input
              list="clip-groups"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              maxLength={60}
              className="field w-44"
              aria-label="Group name"
            />
            <datalist id="clip-groups">
              {groups.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
            <button type="button" className="btn-quiet" disabled={pending || !ids.length || !groupName.trim()} onClick={() => run(() => groupAction(ids, groupName))}>
              Add to group
            </button>
            <button type="button" className="btn-quiet" disabled={pending || !ids.length} onClick={() => run(() => groupAction(ids, null))}>
              Remove from group
            </button>
          </span>
          <button
            type="button"
            className="btn-quiet text-(--down)"
            disabled={pending || !ids.length}
            onClick={() => {
              if (window.confirm(`Delete ${ids.length} clip${ids.length === 1 ? "" : "s"} from the router? This can't be undone.`)) {
                run(() => deleteAction(ids));
              }
            }}
          >
            Delete
          </button>
          {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
          {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
        </div>
      )}

      {byDay(clips, (start) => dayFormat.format(start * 1000)).map(({ day, clips: dayClips }) => (
        <div key={day} className="flex flex-col gap-2">
          <h2 className="text-muted text-sm font-medium">{day}</h2>
          <ul className="panel flex flex-col divide-y divide-foreground/10 px-4">
            {dayClips.map((clip) => (
              <li key={clip.id} className="flex flex-wrap items-center gap-3 py-2">
                {canManage && (
                  <input type="checkbox" checked={selected.has(clip.id)} onChange={() => toggle(clip.id)} aria-label={`Select clip ${clip.id}`} />
                )}
                <button type="button" className="flex-1 text-left" onClick={() => setPlaying(clip)}>
                  <span className="font-medium">{timeFormat.format(clip.start * 1000)}</span>
                  <span className="text-muted">
                    {" "}
                    · {clip.cameraName} · {clip.labels.join(", ") || "clip"} · {clip.seconds} s · {(clip.size / 1e6).toFixed(1)} MB
                  </span>
                </button>
                {clip.group && <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs">{clip.group}</span>}
                <button type="button" className="underline text-sm" onClick={() => setPlaying(clip)}>
                  Play
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
