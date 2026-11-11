"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/access";
import { addComputer, findComputer, normalizeMac, removeComputer, wake, WakeError } from "@/lib/computers";
import { recordAudit } from "@/lib/db";

export type ComputerState = { error?: string; done?: string };

const id = z.uuid();

export async function createComputer(_state: ComputerState, form: FormData): Promise<ComputerState> {
  const user = await requireAdmin();
  const name = String(form.get("name") ?? "").trim();
  const mac = normalizeMac(String(form.get("mac") ?? ""));
  const note = String(form.get("note") ?? "").trim().slice(0, 200);
  if (!name || name.length > 60) return { error: "Give it a name (up to 60 characters)." };
  if (!mac) return { error: "That isn't a MAC address. It looks like 3C-7C-3F-12-34-56 (ipconfig /all, Physical Address)." };
  try {
    await addComputer({ name, mac, note });
  } catch {
    return { error: "That name or MAC address is already in the list." };
  }
  await recordAudit(user.name, "computer.add", name, { mac });
  revalidatePath("/manage/computers");
  return { done: `Added ${name}.` };
}

export async function deleteComputer(computerId: string): Promise<ComputerState> {
  const user = await requireAdmin();
  const computer = await findComputer(id.parse(computerId));
  if (!computer) return { error: "Already removed." };
  await removeComputer(computer.id);
  await recordAudit(user.name, "computer.remove", computer.name, { mac: computer.mac });
  revalidatePath("/manage/computers");
  return { done: `Removed ${computer.name}.` };
}

export async function wakeComputer(computerId: string): Promise<ComputerState> {
  const user = await requireAdmin();
  const computer = await findComputer(id.parse(computerId));
  if (!computer) return { error: "That computer is no longer in the list." };
  try {
    await wake(computer.mac);
  } catch (error) {
    return { error: error instanceof WakeError ? error.message : "Couldn't send the wake signal." };
  }
  await recordAudit(user.name, "computer.wake", computer.name, { mac: computer.mac });
  return { done: `Wake signal sent to ${computer.name}. It usually shows as online in Remote desktop within a minute.` };
}
