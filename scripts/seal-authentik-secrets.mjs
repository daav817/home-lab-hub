// Generates Authentik's random secrets and writes them as a sealed secret, without
// printing them. Run once: re-running changes the keys and breaks the running install.
//
//   node scripts/seal-authentik-secrets.mjs

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const random = (bytes) => randomBytes(bytes).toString("base64url");
const databasePassword = random(32);

const secret = {
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: "authentik-secrets", namespace: "authentik" },
  type: "Opaque",
  stringData: {
    AUTHENTIK_SECRET_KEY: random(48),
    AUTHENTIK_POSTGRESQL__PASSWORD: databasePassword,
    // Key names the PostgreSQL chart reads from the same secret.
    password: databasePassword,
    "postgres-password": random(32),
  },
};

const sealed = execFileSync(".tools/kubeseal.exe", ["--format", "yaml"], {
  input: JSON.stringify(secret),
  encoding: "utf8",
});

writeFileSync("platform/authentik/manifests/authentik-secrets.sealedsecret.yaml", sealed);
console.log("Sealed Authentik secrets written.");
