import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import { listAudit, listManagedApps } from "@/lib/db";
import { deleteApp, setHidden } from "./actions";
import { DeleteButton } from "./delete-button";

async function Manage() {
  const user = await currentUser();
  if (user.level !== "admin") redirect("/");

  const [apps, audit] = await Promise.all([listManagedApps(), listAudit()]);

  return (
    <>
      <ul className="panel flex flex-col divide-y divide-foreground/10 px-5">
        {apps.map((app) => (
          <li key={app.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span>
              <span className="font-medium">{app.name}</span>
              <span className="text-muted block text-sm">
                {app.category} · {app.audience}
                {app.hidden && " · hidden"}
              </span>
            </span>
            <span className="flex items-center gap-4">
              <Link href={`/manage/${app.id}`} className="underline">
                Edit
              </Link>
              <form action={setHidden.bind(null, app.id, !app.hidden)}>
                <button type="submit" className="underline">
                  {app.hidden ? "Show" : "Hide"}
                </button>
              </form>
              <DeleteButton name={app.name} action={deleteApp.bind(null, app.id)} />
            </span>
          </li>
        ))}
      </ul>
      <section className="panel flex flex-col gap-2 p-5">
        <h2 className="text-xl font-medium">Recent changes</h2>
        {audit.length === 0 && <p className="text-muted">No changes yet.</p>}
        <ul className="text-muted text-sm">
          {audit.map((entry) => (
            <li key={entry.id}>
              {entry.at.toLocaleString("en-US")} · {entry.actor} · {entry.action} · {entry.target}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default function ManagePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Manage apps</h1>
        <span className="flex gap-4">
          <Link href="/" className="underline">
            Back to hub
          </Link>
          <Link href="/manage/health" className="underline">
            Health
          </Link>
          <Link href="/manage/backups" className="underline">
            Backups
          </Link>
          <Link href="/manage/drives" className="underline">
            Drives
          </Link>
          <Link href="/manage/new" className="underline">
            Add app
          </Link>
        </span>
      </header>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Manage />
      </Suspense>
    </main>
  );
}
