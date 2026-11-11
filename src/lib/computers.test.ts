import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ sql: vi.fn() }));
const { normalizeMac } = await import("./computers");

describe("computers", () => {
  it("accepts the usual MAC address spellings", () => {
    expect(normalizeMac("AA-BB-CC-dd-ee-ff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac(" aa:bb:cc:dd:ee:0f ")).toBe("aa:bb:cc:dd:ee:0f");
    expect(normalizeMac("aabb.ccdd.eeff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(normalizeMac("aabbccddeeff")).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("rejects anything else", () => {
    expect(normalizeMac("aa:bb:cc:dd:ee")).toBeNull();
    expect(normalizeMac("gg:bb:cc:dd:ee:ff")).toBeNull();
    expect(normalizeMac("ff:ff:ff:ff:ff:ff")).toBeNull();
    expect(normalizeMac("")).toBeNull();
  });
});
