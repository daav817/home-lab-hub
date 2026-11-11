import { Suspense } from "react";
import Link from "next/link";
import { requireAdmin } from "@/lib/access";
import { listComputers, meshUrl } from "@/lib/computers";
import { ComputerList } from "./computer-list";

// Home PCs: wake them from here, then open them in Remote desktop (MeshCentral).
async function Computers() {
  await requireAdmin();
  const computers = await listComputers();
  return <ComputerList computers={computers} meshUrl={meshUrl()} />;
}

export default function ComputersPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="brand-text text-3xl font-bold">Computers</h1>
        <Link href="/manage" className="underline">
          Back to manage
        </Link>
      </header>
      <p className="text-muted text-sm">
        Wake sends a Wake-on-LAN signal on the home network, so a sleeping or switched-off PC starts up. Then open it in
        Remote desktop, which asks for a fresh 2FA code each time and records the session for 30 days.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <Computers />
      </Suspense>
    </main>
  );
}
