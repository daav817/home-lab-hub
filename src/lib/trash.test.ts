import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ sql: vi.fn() }));
const { expiresAt, newTrashId, TRASH_ID, trashDays } = await import("./trash");

describe("trash", () => {
  it("makes ids that its own check accepts", () => {
    const id = newTrashId(1794328046621);
    expect(id).toMatch(/^1794328046621-[a-f0-9]{8}$/);
    expect(TRASH_ID.test(id)).toBe(true);
    expect(TRASH_ID.test("../x")).toBe(false);
  });

  it("keeps items 30 days unless TRASH_DAYS says otherwise", () => {
    expect(trashDays()).toBe(30);
    expect(expiresAt(new Date("2026-11-01T12:00:00Z"), 30).toISOString()).toBe("2026-12-01T12:00:00.000Z");
    vi.stubEnv("TRASH_DAYS", "7");
    expect(trashDays()).toBe(7);
    vi.stubEnv("TRASH_DAYS", "nonsense");
    expect(trashDays()).toBe(30);
    vi.unstubAllEnvs();
  });
});
