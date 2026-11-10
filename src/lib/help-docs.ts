// Documents in the hub's Help panel (the "?" button).
//
// To add one: put the PDF in help/ (repo root; the Dockerfile copies that folder into the
// image) and add an entry below. The audience works like tile audiences: "everyone" for any
// signed-in user, "family" for family and admins, "admin" for admins only.

import type { AccessLevel } from "./access";
import { canSee, type Audience } from "./apps";

export type HelpDoc = {
  slug: string; // the URL name: /api/help/<slug>
  title: string;
  description: string;
  file: string; // a PDF in help/
  audience: Audience;
  updated: string; // shown in the list, e.g. "November 2026"
};

export const helpDocs: HelpDoc[] = [
  {
    slug: "how-it-works",
    title: "How It Works",
    description: "A plain-language guide to the technology behind the hub, for anyone.",
    file: "how-it-works.pdf",
    audience: "family",
    updated: "November 2026",
  },
  {
    slug: "architecture",
    title: "Architecture & Engineering Guide",
    description: "How the platform is built, deployed, secured and recovered, and the roadmap. For engineers.",
    file: "architecture.pdf",
    audience: "admin", // includes network topology
    updated: "November 2026",
  },
];

export const HELP_SLUG = /^[a-z0-9-]{1,60}$/;

export function visibleHelpDocs(level: AccessLevel, docs: HelpDoc[] = helpDocs) {
  return docs.filter((doc) => canSee(level, doc.audience));
}

// The document a user may open, or null (unknown, or not for their access level).
export function findHelpDoc(slug: string, level: AccessLevel, docs: HelpDoc[] = helpDocs) {
  if (!HELP_SLUG.test(slug)) return null;
  return visibleHelpDocs(level, docs).find((doc) => doc.slug === slug) ?? null;
}
