import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { currentUser } from "@/lib/access";
import { findManagedApp } from "@/lib/db";
import { updateApp } from "../actions";
import { AppForm } from "../app-form";

async function EditApp({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (user.level !== "admin") redirect("/");

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const app = await findManagedApp(id);
  if (!app) notFound();

  return <AppForm action={updateApp.bind(null, app.id)} app={app} />;
}

export default function EditAppPage({ params }: PageProps<"/manage/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <h1 className="brand-text text-3xl font-bold">Edit app</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <EditApp params={params} />
      </Suspense>
    </main>
  );
}
