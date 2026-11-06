// No server imports here: the history window in the browser uses this file too.

export type BackupRecord = {
  id: string;
  at: Date;
  result: "Completed" | "Running" | "Failed";
  trigger: "Nightly" | "Manual";
  size: number;
};

export type HistoryFilters = {
  query: string;
  result: BackupRecord["result"] | "all";
  trigger: BackupRecord["trigger"] | "all";
};

export function megabytes(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1_048_576)).toLocaleString("en-US")} MB`;
}

// Every word must match, so "nov failed" finds failed backups in November.
export function filterHistory(
  records: BackupRecord[],
  { query, result, trigger }: HistoryFilters,
  formatDate: (at: Date) => string,
) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);

  return records.filter((record) => {
    if (result !== "all" && record.result !== result) return false;
    if (trigger !== "all" && record.trigger !== trigger) return false;
    const text = `${formatDate(record.at)} ${record.result} ${record.trigger} ${megabytes(record.size)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
