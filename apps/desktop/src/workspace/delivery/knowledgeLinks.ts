/** Linked docs (Confluence etc.) from Jira remote-link attrs — never invent pages. */

export type KnowledgeLink = { title: string; url: string };

/**
 * Read Knowledge links already present on a unit's attributes.
 * Sources: `remoteLinks` JSON array, or single `confluenceUrl` / `knowledgeUrl`.
 * Absence means this unit carries no linked docs — not "Confluence is empty".
 */
export function knowledgeLinksFromAttrs(
  attrs: Record<string, string> | null | undefined,
): KnowledgeLink[] {
  if (!attrs) return [];
  const out: KnowledgeLink[] = [];
  const seen = new Set<string>();

  const push = (title: string, url: string) => {
    const href = url.trim();
    if (!href || seen.has(href)) return;
    if (!/^https?:\/\//i.test(href)) return;
    seen.add(href);
    out.push({ title: title.trim() || href, url: href });
  };

  if (attrs.remoteLinks) {
    try {
      const parsed = JSON.parse(attrs.remoteLinks) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== "object") continue;
          const row = item as { title?: unknown; url?: unknown };
          if (typeof row.url !== "string") continue;
          const title = typeof row.title === "string" ? row.title : row.url;
          push(title, row.url);
        }
      }
    } catch {
      // Malformed attr is not a provider answer — skip, do not invent links.
    }
  }

  if (attrs.confluenceUrl) {
    push(attrs.confluenceTitle || attrs.confluenceUrl, attrs.confluenceUrl);
  }
  if (attrs.knowledgeUrl) {
    push(attrs.knowledgeTitle || attrs.knowledgeUrl, attrs.knowledgeUrl);
  }

  return out;
}
