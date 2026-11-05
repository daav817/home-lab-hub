import { SignInButton } from "./sign-in-button";

export default function SignIn() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="bg-gradient-to-r from-cyan-400 via-violet-500 to-fuchsia-500 bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
        Home Lab Hub
      </h1>
      <SignInButton />
    </main>
  );
}
