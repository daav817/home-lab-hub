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

  // The share list is read once at start and kept fresh, so opening Files never waits for the
  // router (it takes about 11 s to refuse each share the hub's account can't open).
  const { listShares } = await import("./lib/files");
  const warm = () => listShares(true).catch(() => {});
  void warm();
  setInterval(warm, 60_000).unref();

  // SRM recycle bins are measured in the background (a few seconds per share), so Manage >
  // Trash shows their sizes at once: 2 minutes after start, then every 6 hours.
  const { scanBins } = await import("./lib/recycle");
  const measureBins = () => scanBins().catch((error) => console.error("Recycle bin check failed", error));
  setTimeout(measureBins, 120_000).unref();
  setInterval(measureBins, 6 * 3600_000).unref();

  // Upload-folder organizer: a run cut short by a restart is marked so, and the nightly run
  // is checked for every 5 minutes.
  const organizer = await import("./lib/organizer");
  await organizer.markInterrupted().catch((error) => console.error("Organizer: couldn't mark old runs", error));
  const tick = async () => {
    try {
      const run = await organizer.nightlyTick();
      if (run) await recordAudit("hub", "files.organize-started", `run ${run.id}`, { trigger: "nightly", files: run.total });
    } catch (error) {
      console.error("Organizer nightly check failed", error);
    }
  };
  setInterval(tick, 5 * 60_000).unref();

  // Backup of photo/video/music to the second drive: a run cut short by a restart is marked so;
  // the nightly run starts in the organizer's hour once the organizer is idle.
  const mirror = await import("./lib/mirror");
  await mirror.markInterrupted().catch((error) => console.error("Backup: couldn't mark old runs", error));
  const mirrorTick = async () => {
    try {
      await mirror.nightlyTick(organizer.isOrganizing());
    } catch (error) {
      console.error("Backup nightly check failed", error);
    }
  };
  setInterval(mirrorTick, 5 * 60_000).unref();
}
