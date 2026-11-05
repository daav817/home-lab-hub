"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { readAppForm } from "@/lib/app-input";
import { recordAudit, sql } from "@/lib/db";

export type FormState = { error?: string };

const id = z.uuid();

export async function createApp(_state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const input = readAppForm(form);
  if (!input.success) return { error: input.error.issues[0].message };
  const app = input.data;

  try {
    await sql`
      insert into apps (name, description, url, status_url, category, audience, hidden, sort_order)
      values (${app.name}, ${app.description}, ${app.url}, ${app.statusUrl}, ${app.category},
              ${app.audience}, ${app.hidden}, ${app.sortOrder})
    `;
  } catch {
    return { error: "Couldn't save. Is that name already used?" };
  }
  await recordAudit(user.name, "app.create", app.name, app);
  redirect("/manage");
}

export async function updateApp(appId: string, _state: FormState, form: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const target = id.parse(appId);
  const input = readAppForm(form);
  if (!input.success) return { error: input.error.issues[0].message };
  const app = input.data;

  try {
    await sql`
      update apps set
        name = ${app.name}, description = ${app.description}, url = ${app.url},
        status_url = ${app.statusUrl}, category = ${app.category}, audience = ${app.audience},
        hidden = ${app.hidden}, sort_order = ${app.sortOrder}, updated_at = now()
      where id = ${target}
    `;
  } catch {
    return { error: "Couldn't save. Is that name already used?" };
  }
  await recordAudit(user.name, "app.update", app.name, app);
  redirect("/manage");
}

export async function setHidden(appId: string, hidden: boolean) {
  const user = await requireAdmin();
  const [app] = await sql<{ name: string }[]>`
    update apps set hidden = ${hidden}, updated_at = now()
    where id = ${id.parse(appId)}
    returning name
  `;
  if (app) await recordAudit(user.name, hidden ? "app.hide" : "app.show", app.name);
  redirect("/manage");
}

export async function deleteApp(appId: string) {
  const user = await requireAdmin();
  const [app] = await sql<{ name: string }[]>`
    delete from apps where id = ${id.parse(appId)} returning name
  `;
  if (app) await recordAudit(user.name, "app.delete", app.name);
  redirect("/manage");
}
