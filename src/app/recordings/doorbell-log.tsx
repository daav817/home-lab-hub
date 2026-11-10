"use client";

import { useState } from "react";
import type { DoorbellPress } from "@/lib/clips";

const whenFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

// Doorbell presses, newest first. Home Assistant learns of a press from Blink's phone
// notification and wakes the camera; the clip keeper saves the next 90 seconds to the router
// (group "Doorbell", never removed by the size limit). A clip shows up about 2 minutes later;
// a press stays at "No clip yet" if the camera never sent video.
export function DoorbellLog({ presses }: { presses: DoorbellPress[] }) {
  const [playing, setPlaying] = useState<DoorbellPress | null>(null);

  return (
    <section id="doorbell" className="panel flex flex-col gap-3 p-5">
      <h2 className="font-medium">Doorbell</h2>
      {presses.length === 0 ? (
        <p className="text-muted text-sm">No doorbell presses logged yet.</p>
      ) : (
        <>
          {playing?.clip && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>
                  {playing.cameraName} · {whenFormat.format(playing.pressed * 1000)}
                </span>
                <button type="button" className="underline" onClick={() => setPlaying(null)}>
                  Close
                </button>
              </div>
              <video key={playing.clip} src={`/api/clips/${encodeURIComponent(playing.clip)}/video`} controls autoPlay playsInline className="w-full rounded" />
            </div>
          )}
          <ul className="flex max-h-72 flex-col divide-y divide-foreground/10 overflow-y-auto">
            {presses.map((press, i) => (
              <li key={`${press.pressed}-${i}`} className="flex flex-wrap items-center gap-3 py-2">
                <span className="font-medium">{whenFormat.format(press.pressed * 1000)}</span>
                <span className="text-muted flex-1 text-sm">
                  {press.cameraName} · {press.message}
                </span>
                {press.clip ? (
                  <button type="button" className="underline text-sm" onClick={() => setPlaying(press)}>
                    Play clip ({press.seconds} s)
                  </button>
                ) : (
                  <span className="text-muted text-sm">No clip yet</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
