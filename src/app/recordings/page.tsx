import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import {
  canViewClips, ClipsError, getClipStatus, gigabytes, listClips, listDoorbellPresses, listGroups,
  type Clip, type ClipGroup, type ClipStatus, type DoorbellPress,
} from "@/lib/clips";
import { deleteSelected, groupSelected, saveSettings } from "./actions";
import { ClipLibrary } from "./clip-library";
import { ClipSettings } from "./clip-settings";
import { DoorbellLog } from "./doorbell-log";

type Search = { camera?: string; group?: string };

async function Recordings({ search }: { search: Promise<Search> }) {
  const user = await currentUser();
  if (!canViewClips(user.level)) redirect("/");
  const { camera, group } = await search;
  const isAdmin = user.level === "admin";

  let data: [ClipStatus, ClipGroup[], Clip[], DoorbellPress[]];
  try {
    data = await Promise.all([
      getClipStatus(),
      listGroups(),
      listClips({ camera, group: group && group !== "__none" ? group : undefined, ungrouped: group === "__none" }),
      listDoorbellPresses(),
    ]);
  } catch (error) {
    if (!(error instanceof ClipsError)) console.error("Recordings page failed", error);
    return (
      <p role="alert" className="panel px-5 py-3 text-(--down)">
        {error instanceof ClipsError ? error.message : "Couldn't load the recordings."}
      </p>
    );
  }
  const [status, groups, clips, presses] = data;
  const limit = status.limitGb * 1e9;
  const percent = Math.min(100, Math.round((status.used / limit) * 100));
  const storageOk = status.storage === "OK";

  return (
    <>
      <section className="panel flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span>
            Recording: <span className={status.recording === "Off" ? "text-muted" : "text-(--up)"}>{status.recording}</span>
          </span>
          <span className="text-muted text-sm">
            {status.count} clip{status.count === 1 ? "" : "s"} · {gigabytes(status.used)} of {status.limitGb} GB
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-foreground/10" aria-label={`${percent}% of the limit used`}>
          <div className={`h-full ${percent > 90 ? "bg-(--down)" : "bg-(--cyan)"}`} style={{ width: `${percent}%` }} />
        </div>
        {!storageOk && (
          <p role="alert" className="text-sm text-(--down)">
            Router storage: {status.storage}
          </p>
        )}
        <p className="text-muted text-sm">
          Clips of {status.labels.join(", ")} are saved while Away is on or the schedule is on, for the cameras
          switched on below. When the limit is reached the oldest clips are removed first; clips in a group are
          always kept.
        </p>
      </section>

      <DoorbellLog presses={presses} />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-sm">
          Camera
          <select name="camera" defaultValue={camera ?? ""} className="field">
            <option value="">All cameras</option>
            {status.cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Group
          <select name="group" defaultValue={group ?? ""} className="field">
            <option value="">All clips</option>
            <option value="__none">Not in a group</option>
            {groups.map((g) => (
              <option key={g.name} value={g.name}>
                {g.name} ({g.count})
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-quiet">
          Show
        </button>
      </form>

      <ClipLibrary
        clips={clips}
        groups={groups.map((g) => g.name)}
        canManage={isAdmin}
        deleteAction={deleteSelected}
        groupAction={groupSelected}
      />

      {isAdmin && <ClipSettings status={status} action={saveSettings} />}
    </>
  );
}

export default function RecordingsPage({ searchParams }: { searchParams: Promise<Search> }) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Recordings</h1>
        <span className="flex gap-4">
          <Link href="/" className="underline">
            Back to hub
          </Link>
          <a href="https://home.energiapower.llc" className="underline">
            Home Assistant
          </a>
        </span>
      </header>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Recordings search={searchParams} />
      </Suspense>
    </main>
  );
}
