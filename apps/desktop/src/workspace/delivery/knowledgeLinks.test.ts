import { describe, expect, it } from "vitest";
import { knowledgeLinksFromAttrs } from "./knowledgeLinks";

describe("knowledgeLinksFromAttrs", () => {
  it("parses remoteLinks JSON and single confluenceUrl without inventing pages", () => {
    const links = knowledgeLinksFromAttrs({
      remoteLinks: JSON.stringify([
        { title: "Runbook", url: "https://confluence.example/runbook" },
        { title: "skip", url: "not-a-url" },
      ]),
      confluenceUrl: "https://confluence.example/other",
      confluenceTitle: "Other page",
    });
    expect(links).toEqual([
      { title: "Runbook", url: "https://confluence.example/runbook" },
      { title: "Other page", url: "https://confluence.example/other" },
    ]);
  });

  it("returns empty when attrs have no links — absence not Confluence emptiness", () => {
    expect(knowledgeLinksFromAttrs({ key: "OPS-1", status: "Open" })).toEqual([]);
    expect(knowledgeLinksFromAttrs(undefined)).toEqual([]);
  });
});
