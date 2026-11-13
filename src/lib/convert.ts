// On-the-fly conversion for router media browsers can't play (WMA, AVI, MTS, 3GP, MPG, WMV),
// used by /api/files/play. ffmpeg reads the file from the pod's WebDAV view of the router (it
// asks for byte ranges, so formats with their index at the end work) and writes MP3 or
// fragmented MP4 to stdout, which is streamed to the browser while it's being made.
//
// Video already in H.264 (most camcorder MTS files) is copied, not re-encoded, so it starts at
// once and costs almost no CPU; anything else is re-encoded at up to 720p. At most two
// conversions run at a time, and one stops as soon as the browser goes away.

import { spawn } from "node:child_process";

export type ConvertPlan = { contentType: string; args: string[] };

// Kept on globalThis so every route module sees the same count.
const running = ((globalThis as { __hubConversions?: { count: number } }).__hubConversions ??= { count: 0 });
export const MAX_CONVERSIONS = 2;

// What ffmpeg should do with one input, given its first video codec and pixel format
// (from ffprobe; empty for audio-only files).
export function plan(kind: "audio" | "video", input: string, video: { codec: string; pixFmt: string } | null): ConvertPlan {
  const head = ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "2", "-i", input];
  if (kind === "audio") {
    return { contentType: "audio/mpeg", args: [...head, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "mp3", "pipe:1"] };
  }
  const copy = video?.codec === "h264" && (video.pixFmt === "yuv420p" || video.pixFmt === "yuvj420p");
  const videoArgs = copy
    ? ["-c:v", "copy"]
    : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-vf", "scale='min(1280,iw)':-2"];
  return {
    contentType: "video/mp4",
    args: [
      ...head, "-map", "0:v:0?", "-map", "0:a:0?", ...videoArgs,
      "-c:a", "aac", "-b:a", "160k", "-ac", "2",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4", "pipe:1",
    ],
  };
}

// First video stream's codec and pixel format, or null if there's none or ffprobe fails.
export function probeVideo(input: string): Promise<{ codec: string; pixFmt: string } | null> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,pix_fmt", "-of", "csv=p=0", input,
    ], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", () => resolve(null));
    child.on("close", () => {
      clearTimeout(timer);
      const [codec, pixFmt] = out.trim().split("\n")[0]?.split(",") ?? [];
      resolve(codec ? { codec, pixFmt: pixFmt ?? "" } : null);
    });
  });
}

export function busy() {
  return running.count >= MAX_CONVERSIONS;
}

// Starts ffmpeg and returns its output as a web stream; stops it if the browser goes away.
export function convert(args: string[], signal: AbortSignal): ReadableStream<Uint8Array> {
  running.count++;
  const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let finished = false;
  const done = () => {
    if (finished) return;
    finished = true;
    running.count--;
  };
  const stop = () => {
    if (!finished) child.kill("SIGKILL");
  };
  signal.addEventListener("abort", stop, { once: true });
  child.on("close", done);
  child.on("error", done);
  let errors = "";
  child.stderr.on("data", (chunk) => {
    if (errors.length < 2000) errors += chunk;
  });
  child.on("close", (code) => {
    if (code && !signal.aborted) console.error("Conversion failed (ffmpeg %s): %s", code, errors.trim());
  });

  return new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on("data", (chunk: Buffer) => {
        try {
          controller.enqueue(new Uint8Array(chunk));
        } catch {
          stop();
        }
      });
      child.stdout.on("end", () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
      child.on("error", (error) => controller.error(error));
    },
    cancel() {
      stop();
    },
  });
}
