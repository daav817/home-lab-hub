import { describe, expect, it } from "vitest";
import { accessLevel } from "./access";

describe("accessLevel", () => {
  it("gives the highest level a person qualifies for", () => {
    expect(accessLevel(["hub-limited", "hub-family"])).toBe("family");
    expect(accessLevel(["hub-family", "authentik Admins"])).toBe("admin");
  });

  it("keeps limited members limited", () => {
    expect(accessLevel(["hub-limited"])).toBe("limited");
  });

  it("gives no access without a hub group", () => {
    expect(accessLevel([])).toBe("none");
    expect(accessLevel(["some-other-group"])).toBe("none");
  });
});
