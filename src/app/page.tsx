import { Suspense } from "react";
import Link from "next/link";
import { currentUser } from "@/lib/access";
import { visibleApps } from "@/lib/apps";
import { listApps } from "@/lib/db";
import { SignOutButton } from "./sign-out-button";

async function Portal() {
  const user = await currentUser();
  const apps = visibleApps(await listApps(), user.level);
  const categories = [...new Set(apps.map((app) => app.category))];

  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <p className="text-lg opacity-70">
          {user.name} ({user.level} access)
        </p>
        <span className="flex items-center gap-4">
          {user.level === "admin" && (
            <Link href="/manage" className="underline">
              Manage apps
            </Link>
          )}
          <SignOutButton />
        </span>
      </header>
      {apps.length === 0 && (
        <p className="py-16 text-center text-lg opacity-70">No apps have been added for your account yet.</p>
      )}
      {categories.map((category) => (
        <section key={category} className="flex flex-col gap-3">
          <h2 className="text-xl font-medium">{category}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {apps
              .filter((app) => app.category === category)
              .map((app) => (
                <li key={app.id}>
                  <a href={app.url} className="block rounded-lg border border-current/20 p-4 hover:border-cyan-400">
                    <span className="block font-medium">{app.name}</span>
                    <span className="block text-sm opacity-70">{app.description}</span>
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 p-8">
      <h1 className="bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        Home Lab Hub
      </h1>
      <Suspense fallback={<p className="text-lg opacity-70">Loading…</p>}>
        <Portal />
      </Suspense>
    </main>
  );
}
