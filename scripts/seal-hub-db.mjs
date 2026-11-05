// Generates the hub database password and writes it as a sealed secret, without
// printing it. Run once: re-running changes the password and locks the hub out.
//
//   node scripts/seal-hub-db.mjs

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const password = randomBytes(32).toString("base64url");

const secret = {
  apiVersion: "v1",
  kind: "Secret",
  metadata: { name: "hub-db", namespace: "hub" },
  type: "Opaque",
  stringData: {
    POSTGRES_PASSWORD: password,
    DATABASE_URL: `postgres://hub:${password}@hub-postgres:5432/hub`,
  },
};

const sealed = execFileSync(".tools/kubeseal.exe", ["--format", "yaml"], {
  input: JSON.stringify(secret),
  encoding: "utf8",
});

writeFileSync("k8s/hub-db.sealedsecret.yaml", sealed);
console.log("Sealed database secret written.");
