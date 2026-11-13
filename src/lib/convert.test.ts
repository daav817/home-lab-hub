import { describe, expect, it } from "vitest";
import { plan } from "./convert";
import { convertKind, mediaHref, previewKind } from "./files";

describe("media conversion", () => {
  it("knows which formats need converting, and plays them as audio or video", () => {
    expect(convertKind("Song.WMA")).toBe("audio");
    expect(convertKind("clip.mts")).toBe("video");
    expect(convertKind("old.avi")).toBe("video");
    expect(convertKind("song.mp3")).toBeNull();
    expect(previewKind("song.wma")).toBe("audio");
    expect(previewKind("clip.3gp")).toBe("video");
    expect(previewKind("movie.mp4")).toBe("video");
  });

  it("sends convertible files through the converter and the rest straight from the router", () => {
    expect(mediaHref({ share: "music", parts: ["a b", "x.wma"] })).toBe("/api/files/play?path=music%2Fa%20b%2Fx.wma");
    expect(mediaHref({ share: "music", parts: ["x.mp3"] })).toBe("/api/files/raw?path=music%2Fx.mp3");
  });

  it("makes MP3 from audio", () => {
    const p = plan("audio", "http://in/x.wma", null);
    expect(p.contentType).toBe("audio/mpeg");
    expect(p.args).toEqual(expect.arrayContaining(["-i", "http://in/x.wma", "-c:a", "libmp3lame", "-f", "mp3", "pipe:1"]));
  });

  it("copies H.264 video and re-encodes the rest, always as streamable MP4", () => {
    const copy = plan("video", "in", { codec: "h264", pixFmt: "yuv420p" });
    expect(copy.args).toEqual(expect.arrayContaining(["-c:v", "copy"]));
    expect(copy.args).not.toContain("libx264");
    const encode = plan("video", "in", { codec: "mpeg4", pixFmt: "yuv420p" });
    expect(encode.args).toEqual(expect.arrayContaining(["-c:v", "libx264", "-preset", "veryfast"]));
    const tenBit = plan("video", "in", { codec: "h264", pixFmt: "yuv420p10le" });
    expect(tenBit.args).toContain("libx264");
    for (const p of [copy, encode]) {
      expect(p.contentType).toBe("video/mp4");
      expect(p.args).toEqual(expect.arrayContaining(["-movflags", "frag_keyframe+empty_moov+default_base_moof", "-f", "mp4"]));
    }
  });
});
