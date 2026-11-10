"use client";

import { useRef, useState } from "react";
import type { HelpDoc } from "@/lib/help-docs";

type Doc = Pick<HelpDoc, "slug" | "title" | "description" | "updated">;

// The "?" button and the Help panel: a list of documents, each readable in the panel, in a new
// tab, or as a download. The server passes only the documents this user may open.
export function HelpButton({ docs }: { docs: Doc[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reading, setReading] = useState<Doc | null>(null);

  const close = () => {
    dialog.current?.close();
    setReading(null);
  };

  return (
    <>
      <button
        type="button"
        className="btn-quiet h-9 w-9 rounded-full p-0 text-lg font-bold"
        aria-label="Help"
        title="Help"
        onClick={() => dialog.current?.showModal()}
      >
        ?
      </button>
      <dialog
        ref={dialog}
        onClose={() => setReading(null)}
        onClick={(e) => e.target === dialog.current && close()}
        className="panel m-auto w-[min(64rem,calc(100vw-2rem))] p-0 text-foreground backdrop:bg-black/70"
        aria-label="Help"
      >
        <div className="flex max-h-[90vh] flex-col gap-4 p-5">
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">{reading ? reading.title : "Help"}</h2>
            <span className="flex items-center gap-4">
              {reading && (
                <>
                  <button type="button" className="underline" onClick={() => setReading(null)}>
                    All documents
                  </button>
                  <a href={`/api/help/${reading.slug}`} target="_blank" rel="noreferrer" className="underline">
                    Open in new tab
                  </a>
                  <a href={`/api/help/${reading.slug}?download=1`} className="underline">
                    Download
                  </a>
                </>
              )}
              <button type="button" className="btn-quiet" onClick={close}>
                Close
              </button>
            </span>
          </header>

          {reading ? (
            <iframe
              key={reading.slug}
              src={`/api/help/${reading.slug}`}
              title={reading.title}
              className="h-[75vh] w-full rounded border border-foreground/10 bg-white"
            />
          ) : docs.length === 0 ? (
            <p className="text-muted">No documents are available for your account yet.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-foreground/10">
              {docs.map((doc) => (
                <li key={doc.slug} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{doc.title}</span>
                    <span className="text-muted block text-sm">
                      {doc.description} · PDF · {doc.updated}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <button type="button" className="btn-quiet" onClick={() => setReading(doc)}>
                      Read
                    </button>
                    <a href={`/api/help/${doc.slug}?download=1`} className="underline text-sm">
                      Download
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </dialog>
    </>
  );
}
