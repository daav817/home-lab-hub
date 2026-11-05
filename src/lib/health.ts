export type Health = {
  status: "ok";
  version: string;
};

export function getHealth(version = process.env.APP_VERSION): Health {
  return { status: "ok", version: version || "dev" };
}
