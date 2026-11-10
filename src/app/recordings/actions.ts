"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { cleanGroupName, CLIP_ID, ClipsError, deleteClips, groupClips, saveClipSettings } from "@/lib/clips";
import { recordAudit } from "@/lib/db";

export type ClipActionState = { error?: string; done?: string };

const ids = z.array(z.string().regex(CLIP_ID)).min(1).max(500);

function failure(error: unknown): ClipActionState {
  if (error instanceof ClipsError) return { error: error.message };
  console.error("Clip action failed", error);
  return { error: "That didn't work. Try again." };
}

export async function deleteSelected(clipIds: string[]): Promise<ClipActionState> {
  const user = await requireAdmin();
  const parsed = ids.safeParse(clipIds);
  if (!parsed.success) return { error: "Select at least one clip." };
  try {
    const deleted = await deleteClips(parsed.data);
    await recordAudit(user.name, "clips.delete", `${deleted} clip(s)`, { ids: parsed.data });
    revalidatePath("/recordings");
    return { done: `Deleted ${deleted} clip${deleted === 1 ? "" : "s"}.` };
  } catch (error) {
    return failure(error);
  }
}

// group: a name to put the clips in that group, or null to take them out of their group.
export async function groupSelected(clipIds: string[], group: string | null): Promise<ClipActionState> {
  const user = await requireAdmin();
  const parsed = ids.safeParse(clipIds);
  if (!parsed.success) return { error: "Select at least one clip." };
  const name = group === null ? null : cleanGroupName(group);
  if (group !== null && !name) return { error: "Group names: letters, numbers and spaces, up to 60 characters." };
  try {
    const changed = await groupClips(parsed.data, name);
    await recordAudit(user.name, name ? "clips.group" : "clips.ungroup", name ?? `${changed} clip(s)`, { ids: parsed.data });
    revalidatePath("/recordings");
    return { done: name ? `Added ${changed} to “${name}”.` : `Removed ${changed} from their group.` };
  } catch (error) {
    return failure(error);
  }
}

const settings = z.object({
  limitGb: z.number().int().min(100).max(500),
  away: z.boolean(),
  cameras: z.record(z.string().regex(/^[a-z0-9_]{1,64}$/), z.boolean()),
});

export async function saveSettings(input: z.input<typeof settings>): Promise<ClipActionState> {
  const user = await requireAdmin();
  const parsed = settings.safeParse(input);
  if (!parsed.success) return { error: "Those settings aren't valid." };
  try {
    await saveClipSettings(parsed.data);
    await recordAudit(user.name, "clips.settings", `limit ${parsed.data.limitGb} GB`, parsed.data);
    revalidatePath("/recordings");
    return { done: "Settings saved." };
  } catch (error) {
    return failure(error);
  }
}
