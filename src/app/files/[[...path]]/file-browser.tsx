"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { folderHref, formatBytes, joinPath, previewKind, rawHref, type Entry, type FilePath } from "@/lib/files";
import { deleteEntries, newFolder, renameEntry, type FileActionState } from "../actions";

const CHUNK = 8 * 1024 * 1024; // must match CHUNK_BYTES in src/lib/uploads.ts
const PAGE = 300;
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

type Props = { folder: FilePath; entries: Entry[]; canManage: boolean };
type Upload = { name: string; sent: number; total: number; error?: string; done?: boolean };

function icon(entry: Entry) {
  if (entry.isDir) return "📁";
  switch (previewKind(entry.name)) {
    case "image": return "🖼️";
    case "video": return "🎞️";
    case "audio": return "🎵";
    case "pdf": return "📄";
    default: return "📄";
  }
}

async function sendFile(folder: FilePath, file: File, onProgress: (sent: number) => void) {
  const id = crypto.randomUUID();
  let offset = 0;
  let failures = 0;
  do {
    const piece = file.slice(offset, Math.min(offset + CHUNK, file.size));
    let response: Response;
    try {
      response = await fetch("/api/files/upload", {
        method: "POST",
        headers: {
          "X-Upload-Id": id,
          "X-Upload-Folder": encodeURIComponent(joinPath(folder)),
          "X-Upload-Name": encodeURIComponent(file.name),
          "X-Upload-Offset": String(offset),
          "X-Upload-Total": String(file.size),
          "X-Chunk-Length": String(piece.size),
        },
        body: piece,
      });
    } catch {
      if (++failures > 3) throw new Error("Connection lost.");
      await new Promise((r) => setTimeout(r, 2000 * failures));
      continue;
    }
    const result = (await response.json().catch(() => ({}))) as { received?: number; done?: boolean; error?: string };
    if (!response.ok) {
      if (response.status >= 500 && ++failures <= 3) continue;
      throw new Error(result.error ?? `Upload failed (HTTP ${response.status}).`);
    }
    failures = 0;
    offset = result.received ?? offset + piece.size;
    onProgress(offset);
    if (result.done) return;
  } while (offset < file.size || file.size === 0);
}

export function FileBrowser({ folder, entries, canManage }: Props) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [viewing, setViewing] = useState<Entry | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [message, setMessage] = useState<FileActionState>({});
  const [pending, startTransition] = useTransition();

  const pathOf = (entry: Entry) => ({ share: folder.share, parts: [...folder.parts, entry.name] });
  const images = entries.filter((e) => !e.isDir && previewKind(e.name) === "image");
  const chosen = entries.filter((e) => selected.has(e.name));

  const toggle = (name: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const run = (action: () => Promise<FileActionState>) =>
    startTransition(async () => {
      const result = await action();
      setMessage(result);
      if (!result.error) {
        setSelected(new Set());
        router.refresh();
      }
    });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files];
    setUploads(list.map((f) => ({ name: f.name, sent: 0, total: f.size })));
    for (const [i, file] of list.entries()) {
      const update = (patch: Partial<Upload>) => setUploads((u) => u.map((x, j) => (j === i ? { ...x, ...patch } : x)));
      try {
        await sendFile(folder, file, (sent) => update({ sent }));
        update({ done: true, sent: file.size });
      } catch (error) {
        update({ error: error instanceof Error ? error.message : "Upload failed." });
      }
    }
    router.refresh();
  };

  const open = (entry: Entry) => {
    const kind = previewKind(entry.name);
    // PDFs and text open in a new tab (the hub never shows router files in a frame).
    if (kind === "pdf" || kind === "text") window.open(rawHref(pathOf(entry)), "_blank", "noopener");
    else if (kind) setViewing(entry);
    else window.location.href = rawHref(pathOf(entry), true);
  };

  const step = (by: number) => {
    if (!viewing) return;
    const at = images.findIndex((e) => e.name === viewing.name);
    if (at >= 0 && images.length > 1) setViewing(images[(at + by + images.length) % images.length]);
  };

  return (
    <section className="flex flex-col gap-4">
      {canManage && (
        <div className="panel sticky top-2 z-10 flex flex-wrap items-center gap-3 px-4 py-3">
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
          <button type="button" className="btn-quiet" onClick={() => fileInput.current?.click()}>
            Upload
          </button>
          <button
            type="button"
            className="btn-quiet"
            disabled={pending}
            onClick={() => {
              const name = window.prompt("New folder name");
              if (name) run(() => newFolder(joinPath(folder), name));
            }}
          >
            New folder
          </button>
          <span className="text-muted text-sm">{selected.size} selected</span>
          <button
            type="button"
            className="btn-quiet"
            disabled={pending || chosen.length !== 1}
            onClick={() => {
              const name = window.prompt("New name", chosen[0].name);
              if (name && name !== chosen[0].name) run(() => renameEntry(joinPath(pathOf(chosen[0])), name));
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="btn-quiet text-(--down)"
            disabled={pending || chosen.length === 0}
            onClick={() => {
              const folders = chosen.filter((e) => e.isDir).length;
              const warning = folders ? ` ${folders} of them ${folders === 1 ? "is a folder" : "are folders"}: everything inside goes too.` : "";
              if (window.confirm(`Delete ${chosen.length} item${chosen.length === 1 ? "" : "s"} from the router?${warning} Only the share's Recycle Bin (if it's on in SRM) can bring them back.`)) {
                run(() => deleteEntries(chosen.map((e) => ({ path: joinPath(pathOf(e)), isDir: e.isDir }))));
              }
            }}
          >
            Delete
          </button>
          {message.error && <span role="alert" className="text-sm text-(--down)">{message.error}</span>}
          {message.done && <span className="text-sm text-(--up)">{message.done}</span>}
        </div>
      )}

      {uploads.length > 0 && (
        <ul className="panel flex flex-col gap-2 px-4 py-3 text-sm">
          {uploads.map((u, i) => (
            <li key={i} className="flex flex-col gap-1">
              <span className="flex justify-between gap-3">
                <span className="truncate">{u.name}</span>
                <span className={u.error ? "text-(--down)" : u.done ? "text-(--up)" : "text-muted"}>
                  {u.error ?? (u.done ? "Uploaded" : `${formatBytes(u.sent)} of ${formatBytes(u.total)}`)}
                </span>
              </span>
              {!u.error && !u.done && (
                <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
                  <div className="h-full bg-(--cyan)" style={{ width: `${u.total ? Math.round((u.sent / u.total) * 100) : 0}%` }} />
                </div>
              )}
            </li>
          ))}
          {uploads.every((u) => u.done || u.error) && (
            <button type="button" className="self-start underline" onClick={() => setUploads([])}>
              Clear
            </button>
          )}
        </ul>
      )}

      {viewing && (
        <div role="dialog" aria-modal="true" aria-label={viewing.name} className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" onClick={() => setViewing(null)}>
          <div className="flex items-center justify-between gap-3 pb-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="truncate">{viewing.name}</span>
            <span className="flex gap-4">
              {previewKind(viewing.name) === "image" && images.length > 1 && (
                <>
                  <button type="button" className="underline" onClick={() => step(-1)}>Previous</button>
                  <button type="button" className="underline" onClick={() => step(1)}>Next</button>
                </>
              )}
              <a href={rawHref(pathOf(viewing), true)} className="underline">Download</a>
              <button type="button" className="underline" onClick={() => setViewing(null)}>Close</button>
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {previewKind(viewing.name) === "image" && (
              // eslint-disable-next-line @next/next/no-img-element -- router files, served as they are
              <img key={viewing.name} src={rawHref(pathOf(viewing))} alt={viewing.name} className="max-h-full max-w-full object-contain" />
            )}
            {previewKind(viewing.name) === "video" && (
              <video key={viewing.name} src={rawHref(pathOf(viewing))} controls autoPlay playsInline className="max-h-full max-w-full" />
            )}
            {previewKind(viewing.name) === "audio" && <audio key={viewing.name} src={rawHref(pathOf(viewing))} controls autoPlay />}
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <p className="panel text-muted px-5 py-4">This folder is empty.</p>
      ) : (
        <ul className="panel flex flex-col divide-y divide-foreground/10 px-4">
          {entries.slice(0, shown).map((entry) => (
            <li key={entry.name} className="flex items-center gap-3 py-2">
              {canManage && (
                <input type="checkbox" checked={selected.has(entry.name)} onChange={() => toggle(entry.name)} aria-label={`Select ${entry.name}`} />
              )}
              <span aria-hidden>{icon(entry)}</span>
              {entry.isDir ? (
                <Link href={folderHref(pathOf(entry))} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {entry.name}
                </Link>
              ) : (
                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => open(entry)}>
                  {entry.name}
                </button>
              )}
              <span className="text-muted hidden w-40 text-right text-sm sm:block">
                {entry.modified ? dateFormat.format(new Date(entry.modified)) : ""}
              </span>
              <span className="text-muted w-20 text-right text-sm">{entry.isDir ? "" : formatBytes(entry.size)}</span>
              {!entry.isDir && (
                <a href={rawHref(pathOf(entry), true)} className="text-sm underline" aria-label={`Download ${entry.name}`}>
                  Download
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {entries.length > shown && (
        <button type="button" className="btn-quiet self-center" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({entries.length - shown} left)
        </button>
      )}
    </section>
  );
}
