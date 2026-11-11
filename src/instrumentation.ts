export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const { migrate } = await import("./lib/migrate");
  await migrate();

  // Router files left in the hub's Trash longer than TRASH_DAYS are deleted for good, hourly.
  const { emptyExpired } = await import("./lib/trash");
  const { recordAudit } = await import("./lib/db");
  const sweep = async () => {
    try {
      for (const item of await emptyExpired()) {
        await recordAudit("hub", "files.trash-expired", `${item.share}/${item.original}`, { trashId: item.id });
      }
    } catch (error) {
      console.error("Trash sweep failed", error);
    }
  };
  setInterval(sweep, 3600_000).unref();
  setTimeout(sweep, 60_000).unref();
}
