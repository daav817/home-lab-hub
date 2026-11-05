import { describe, expect, it } from "vitest";
import { getHealth } from "./health";

describe("getHealth", () => {
  it("reports the running version", () => {
    expect(getHealth("0.1.0.7")).toEqual({ status: "ok", version: "0.1.0.7" });
  });

  it("falls back to dev when no version is set", () => {
    expect(getHealth("")).toEqual({ status: "ok", version: "dev" });
  });
});
