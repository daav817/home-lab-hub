// Signing out of the hub also ends the Authentik session, so the tiles behind Authentik
// (Frigate, Headlamp, Prometheus...) stop opening without a login. Authentik's end-session
// endpoint runs the hub provider's invalidation flow, which logs the user out, then sends
// the browser back to the hub's sign-in page. That address must be registered as a logout
// redirect on the provider (platform/authentik/manifests/blueprints.yaml), and Authentik
// only honours it with the ID token from sign-in.
export function authentikSignOutUrl(issuer: string, hubUrl: string, idToken?: string) {
  const url = new URL("end-session/", issuer.endsWith("/") ? issuer : `${issuer}/`);
  if (idToken) {
    url.searchParams.set("id_token_hint", idToken);
    url.searchParams.set("post_logout_redirect_uri", new URL("/sign-in", hubUrl).toString());
  }
  return url.toString();
}
