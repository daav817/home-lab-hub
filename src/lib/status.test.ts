import { afterEach, describe, expect, it, vi } from "vitest";
import { checkStatus, classifyResponse } from "./status";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyResponse", () => {
  it.each([200, 204, 302, 401, 403, 404])("treats %i as up", (code) => {
    expect(classifyResponse(code)).toBe("up");
  });

  it.each([500, 502, 503, 504])("treats %i as down", (code) => {
    expect(classifyResponse(code)).toBe("down");
  });
});

describe("checkStatus", () => {
  it("is unknown with no status address, and makes no request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await checkStatus(null)).toBe("unknown");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is down when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timed out")));
    expect(await checkStatus("http://failing.test")).toBe("down");
  });

  it("reuses a recent result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchMock);
    await checkStatus("http://cached.test");
    await checkStatus("http://cached.test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
