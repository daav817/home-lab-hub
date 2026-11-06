import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import { createApp } from "../actions";
import { AppForm } from "../app-form";

async function NewApp() {
  const user = await currentUser();
  if (user.level !== "admin") redirect("/");
  return (
    <>
      <p className="text-muted">
        Adding a tile doesn&apos;t protect an app.{" "}
        <a
          href="https://github.com/daav817/home-lab-hub/blob/main/docs/add-an-app.md"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          How to add an app
        </a>
      </p>
      <AppForm action={createApp} />
    </>
  );
}

export default function NewAppPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <h1 className="brand-text text-3xl font-bold">Add app</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <NewApp />
      </Suspense>
    </main>
  );
}
