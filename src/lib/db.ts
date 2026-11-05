import postgres from "postgres";
import type { App } from "./apps";

export const sql = postgres(process.env.DATABASE_URL ?? "", { max: 5, onnotice: () => {} });

export async function listApps(): Promise<App[]> {
  return sql<App[]>`
    select id, name, description, url, category, audience, hidden
    from apps
    order by sort_order, name
  `;
}
