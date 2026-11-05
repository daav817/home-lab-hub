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

export type ManagedApp = App & { statusUrl: string | null; sortOrder: number };

const managedColumns = sql`
  id, name, description, url, status_url as "statusUrl", category, audience, hidden,
  sort_order as "sortOrder"
`;

export async function listManagedApps(): Promise<ManagedApp[]> {
  return sql<ManagedApp[]>`select ${managedColumns} from apps order by sort_order, name`;
}

export async function findManagedApp(id: string): Promise<ManagedApp | undefined> {
  const [app] = await sql<ManagedApp[]>`select ${managedColumns} from apps where id = ${id}`;
  return app;
}

export async function recordAudit(actor: string, action: string, target: string, detail?: object) {
  await sql`
    insert into audit_log (actor, action, target, detail)
    values (${actor}, ${action}, ${target}, ${detail ? sql.json(JSON.parse(JSON.stringify(detail))) : null})
  `;
}

export async function listAudit(limit = 20) {
  return sql<{ id: string; at: Date; actor: string; action: string; target: string }[]>`
    select id, at, actor, action, target from audit_log order by id desc limit ${limit}
  `;
}
