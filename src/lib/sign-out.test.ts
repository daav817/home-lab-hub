import { describe, expect, it } from "vitest";
import { authentikSignOutUrl } from "./sign-out";

const issuer = "https://auth.energiapower.llc/application/o/home-lab-hub/";

describe("authentikSignOutUrl", () => {
  it("sends the ID token and the hub's sign-in page", () => {
    const url = new URL(authentikSignOutUrl(issuer, "https://hub.energiapower.llc", "abc"));
    expect(url.origin + url.pathname).toBe(`${issuer}end-session/`);
    expect(url.searchParams.get("id_token_hint")).toBe("abc");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://hub.energiapower.llc/sign-in");
  });

  it("still ends the session without an ID token, but asks for no redirect", () => {
    // Authentik refuses a redirect without the token, so it shows its own login page instead.
    expect(authentikSignOutUrl(issuer.slice(0, -1), "https://hub.energiapower.llc")).toBe(`${issuer}end-session/`);
  });
});
