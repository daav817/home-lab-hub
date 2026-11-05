export type SearchItem = { id: string; name: string; description: string; url: string };

export function searchApps(items: SearchItem[], query: string): SearchItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter((item) => {
    const text = `${item.name} ${item.description}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
