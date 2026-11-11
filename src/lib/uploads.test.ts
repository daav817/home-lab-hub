import { describe, expect, it } from "vitest";
import { CHUNK_BYTES, checkChunk, MAX_UPLOAD_BYTES } from "./uploads";

describe("upload pieces", () => {
  const total = CHUNK_BYTES * 2 + 100;

  it("accepts full pieces in order and a short last piece", () => {
    expect(checkChunk({ offset: 0, length: CHUNK_BYTES, total, staged: 0 })).toBeNull();
    expect(checkChunk({ offset: CHUNK_BYTES * 2, length: 100, total, staged: CHUNK_BYTES * 2 })).toBeNull();
    expect(checkChunk({ offset: 0, length: 0, total: 0, staged: 0 })).toBeNull();
  });

  it("asks the browser to resend from what's staged when out of order", () => {
    expect(checkChunk({ offset: CHUNK_BYTES, length: CHUNK_BYTES, total, staged: 0 })).toBe("out-of-order");
  });

  it("refuses short middle pieces, overruns, oversize pieces and huge files", () => {
    expect(checkChunk({ offset: 0, length: 100, total, staged: 0 })).toBe("Piece too small.");
    expect(checkChunk({ offset: 0, length: 200, total: 100, staged: 0 })).toBe("Piece runs past the end of the file.");
    expect(checkChunk({ offset: 0, length: CHUNK_BYTES + 1, total, staged: 0 })).toBe("Piece too large.");
    expect(checkChunk({ offset: 0, length: CHUNK_BYTES, total: MAX_UPLOAD_BYTES + 1, staged: 0 })).toMatch(/too large/);
  });
});
