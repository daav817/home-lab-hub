import { z } from "zod";

// Tile links are rendered as hrefs, so a javascript: URL would run in the viewer's browser.
const webUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      return ["http:", "https:"].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Must be a full http or https address");

export const appInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  description: z.string().trim().max(200),
  url: webUrl,
  statusUrl: z.union([z.literal(""), webUrl]).transform((value) => value || null),
  category: z.string().trim().min(1, "Category is required").max(40),
  audience: z.enum(["everyone", "family", "admin"]),
  hidden: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(10000),
});

export type AppInput = z.output<typeof appInput>;

export function readAppForm(form: FormData) {
  return appInput.safeParse({
    name: form.get("name"),
    description: form.get("description") ?? "",
    url: form.get("url"),
    statusUrl: form.get("statusUrl") ?? "",
    category: form.get("category"),
    audience: form.get("audience"),
    hidden: form.get("hidden") === "on",
    sortOrder: form.get("sortOrder") ?? 100,
  });
}
