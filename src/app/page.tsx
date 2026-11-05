import { Suspense } from "react";
import { getServerSession } from "next-auth";
import { accessLevel } from "@/lib/access";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

async function Welcome() {
  const session = await getServerSession(authOptions);
  return (
    <>
      <p className="text-lg opacity-70">
        Signed in as {session?.user?.name} ({accessLevel(session?.groups ?? [])} access)
      </p>
      <SignOutButton />
    </>
  );
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        Home Lab Hub
      </h1>
      <Suspense fallback={<p className="text-lg opacity-70">Loading…</p>}>
        <Welcome />
      </Suspense>
    </main>
  );
}
