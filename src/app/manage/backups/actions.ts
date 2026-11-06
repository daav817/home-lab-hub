"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { BackupError, startBackup } from "@/lib/backups";
import { recordAudit } from "@/lib/db";

export type BackupState = { error?: string };

const volumeName = z.string().regex(/^pvc-[0-9a-f-]{36}$/);

export async function backUpNow(volume: string): Promise<BackupState> {
  const user = await requireAdmin();
  const parsed = volumeName.safeParse(volume);
  if (!parsed.success) return { error: "That isn't a valid volume." };

  let name: string;
  try {
    name = await startBackup(parsed.data);
  } catch (error) {
    if (error instanceof BackupError) return { error: error.message };
    console.error("Backup start failed", error);
    return { error: "Couldn't start the backup." };
  }
  await recordAudit(user.name, "backup.start", name);
  redirect("/manage/backups");
}
