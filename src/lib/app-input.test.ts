import { describe, expect, it } from "vitest";
import { appInput } from "./app-input";

const valid = {
  name: "Photos",
  description: "",
  url: "https://photos.energiapower.llc",
  statusUrl: "",
  category: "Family",
  audience: "everyone",
  hidden: false,
  sortOrder: 10,
};

describe("appInput", () => {
  it("accepts a normal app and blanks the empty status address", () => {
    const result = appInput.parse(valid);
    expect(result.statusUrl).toBeNull();
  });

  it.each(["javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "not a url"])(
    "rejects %s as a tile link",
    (url) => {
      expect(appInput.safeParse({ ...valid, url }).success).toBe(false);
    },
  );

  it("rejects a non-web status address", () => {
    expect(appInput.safeParse({ ...valid, statusUrl: "gopher://x" }).success).toBe(false);
  });

  it("rejects an unknown audience", () => {
    expect(appInput.safeParse({ ...valid, audience: "public" }).success).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(appInput.safeParse({ ...valid, name: "   " }).success).toBe(false);
  });
});
