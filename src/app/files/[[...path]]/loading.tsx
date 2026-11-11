// Shown at once when opening a share or folder; big folders take a few seconds to list.
export default function Loading() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
      <h1 className="brand-text text-3xl font-bold">Files</h1>
      <p className="text-muted" role="status">
        Reading the router…
      </p>
    </main>
  );
}
