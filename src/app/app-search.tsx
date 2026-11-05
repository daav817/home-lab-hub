"use client";

import { useEffect, useRef, useState } from "react";
import { searchApps, type SearchItem } from "@/lib/search";

export function AppSearch({ items }: { items: SearchItem[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const results = searchApps(items, query);

  const open = () => {
    setQuery("");
    dialog.current?.showModal();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button type="button" onClick={open} className="btn-quiet">
        Search <kbd className="text-muted text-sm">Ctrl K</kbd>
      </button>
      <dialog
        ref={dialog}
        aria-label="Search apps"
        className="panel m-auto w-[min(32rem,calc(100vw-2rem))] p-3 text-foreground"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (results[0]) window.location.assign(results[0].url);
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps"
            aria-label="Search apps"
            className="field w-full"
          />
        </form>
        <ul className="mt-2 flex flex-col">
          {results.map((item) => (
            <li key={item.id}>
              <a href={item.url} className="block rounded-lg px-3 py-2 hover:bg-foreground/10">
                <span className="block font-medium">{item.name}</span>
                <span className="text-muted block text-sm">{item.description}</span>
              </a>
            </li>
          ))}
          {results.length === 0 && <li className="text-muted px-3 py-2">No matching apps.</li>}
        </ul>
      </dialog>
    </>
  );
}
