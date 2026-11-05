// Reads the hub's client secret from Authentik, generates a session key, and writes
// both as a sealed secret, without printing them. Run again only to rotate them.
//
//   node scripts/seal-hub-auth.mjs

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const read = `
from authentik.providers.oauth2.models import OAuth2Provider
print("CLIENT_SECRET=" + OAuth2Provider.objects.get(name="home-lab-hub").client_secret)
`;

const output = execFileSync(
  "kubectl",
  ["exec", "-n", "authentik", "deploy/authentik-worker", "--", "ak", "shell", "-c", read],
  { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
);

const clientSecret = output.match(/^CLIENT_SECRET=(.+)$/m)?.[1]?.trim();
if (!clientSecret) throw new Error("Could not read the client secret from Authentik.");

const secret = {
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: "hub-auth", namespace: "hub" },
  type: "Opaque",
  stringData: {
    AUTHENTIK_CLIENT_SECRET: clientSecret,
    NEXTAUTH_SECRET: randomBytes(48).toString("base64url"),
  },
};

const sealed = execFileSync(".tools/kubeseal.exe", ["--format", "yaml"], {
  input: JSON.stringify(secret),
  encoding: "utf8",
});

writeFileSync("k8s/hub-auth.sealedsecret.yaml", sealed);
console.log("Sealed hub secrets written.");
