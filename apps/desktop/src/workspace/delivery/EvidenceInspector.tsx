import { useState, type ReactNode } from "react";
import type { DevOpsProfile } from "@srelens/core";
import { Button } from "../../ui";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { SituationBadge } from "./SituationBadge";
import { sourceLabel, stageHeading } from "./DeliveryStageRail";
import { knowledgeLinksFromAttrs } from "./knowledgeLinks";
import type { TraceEdge, TraceNode } from "../model/deliveryTypes";
import type { DeliveryViewModel } from "../model/deliveryViewModel";
import type { RuntimeHandoff } from "../runtimeHandoff";
import { runtimeHandoffFromAttrs } from "../runtimeHandoff";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "runtime", label: "Runtime" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export type InspectorView = Pick<
  DeliveryViewModel,
  "workId" | "title" | "contour" | "service" | "stageLabel" | "situations" | "verdict"
>;

const LEVEL_WORD = {
  loud: "Loud",
  notable: "Notable",
  calm: "Calm",
} as const;

/** Details derived from the selected trace unit, split into Overview / Evidence / Runtime. */
export function EvidenceInspector({
  node,
  incoming,
  unitErrors = [],
  view = null,
  profile = null,
  profileId,
  onExploreRuntime,
}: {
  node: TraceNode | null;
  incoming: TraceEdge | null;
  unitErrors?: { source: string; message: string }[];
  /** Delivery-level fields for Overview — compact, not a second DeliveryHeader. */
  view?: InspectorView | null;
  profile?: Pick<DevOpsProfile, "id" | "label"> | null;
  profileId?: string;
  onExploreRuntime?: (target?: RuntimeHandoff) => void;
}) {
  const [section, setSection] = useState<SectionId>("overview");

  if (!node) {
    return (
      <p className="px-4 py-5 text-sm text-muted-foreground">
        Select a unit in the delivery chain.
      </p>
    );
  }

  const runtime =
    node.stage === "runtime" || node.stage === "deployment"
      ? runtimeHandoffFromAttrs(node.attributes, "deployments", profileId ?? profile?.id)
      : null;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="evidence-inspector">
      <header className="shrink-0 border-b border-border px-4 pt-3">
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {stageHeading(node.stage)} · {sourceLabel(node.source)}
        </p>
        <h2 className="mt-1 text-sm font-semibold">{node.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {node.status || "No status returned"} ·{" "}
          <span className="workspace-shell__mono">{node.kind}</span>
        </p>
        <InspectorTabs active={section} onChange={setSection} />
      </header>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === "overview" ? (
          <OverviewPane node={node} view={view} unitErrors={unitErrors} />
        ) : null}
        {section === "evidence" ? <EvidencePane incoming={incoming} /> : null}
        {section === "runtime" ? (
          <RuntimePane
            node={node}
            runtime={runtime}
            onExploreRuntime={onExploreRuntime}
          />
        ) : null}
      </div>
    </section>
  );
}

/** Word-labelled section tabs — colour is never the only signal. */
function InspectorTabs({
  active,
  onChange,
}: {
  active: SectionId;
  onChange: (id: SectionId) => void;
}) {
  return (
    <div role="tablist" aria-label="Delivery inspector sections" className="mt-3 flex gap-1">
      {SECTIONS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            className={`border-b-2 px-2 py-1.5 text-xs font-medium transition-colors ${
              selected
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function OverviewPane({
  node,
  view,
  unitErrors,
}: {
  node: TraceNode;
  view: InspectorView | null;
  unitErrors: { source: string; message: string }[];
}) {
  const verdict = view?.verdict;
  const verdictText =
    verdict?.summary ??
    view?.situations.find((s) => s.level === "loud")?.label ??
    view?.situations[0]?.label ??
    null;
  const levelWord =
    verdict?.severity ??
    view?.situations.find((s) => s.level === "loud")?.level ??
    view?.situations[0]?.level;

  return (
    <div data-testid="inspector-overview">
      {view ? (
        <div className="border-b border-border px-4 py-3 text-sm" data-testid="inspector-work-meta">
          <p className="font-medium">
            <span className="workspace-shell__mono">{view.workId}</span> {view.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {view.contour} · {view.service} · {view.stageLabel}
          </p>
        </div>
      ) : null}

      {verdictText && levelWord ? (
        <div className="border-b border-border px-4 py-3 text-sm" data-testid="inspector-verdict">
          <p>
            <span
              className="font-medium"
              style={{
                color:
                  levelWord === "loud"
                    ? "var(--ws-situation-loud)"
                    : levelWord === "notable"
                      ? "var(--ws-situation-notable)"
                      : "var(--ws-situation-calm)",
              }}
            >
              {LEVEL_WORD[levelWord]}
            </span>
            <span className="text-muted-foreground"> — {verdictText}</span>
          </p>
          {verdict?.primaryAction ? (
            <p className="mt-1 text-xs text-muted-foreground">{verdict.primaryAction}</p>
          ) : null}
        </div>
      ) : null}

      {view && view.situations.length > 0 ? (
        <ul className="flex flex-col gap-1 border-b border-border px-4 py-3">
          {view.situations.map((s) => (
            <li key={s.label}>
              <SituationBadge situation={s} />
            </li>
          ))}
        </ul>
      ) : null}

      {unitErrors.length > 0 ? (
        <div className="border-b border-border px-4 py-3" role="status">
          {unitErrors.map((error) => (
            <p key={`${error.source}:${error.message}`} className="text-sm">
              {sourceLabel(error.source)}: {error.message}
            </p>
          ))}
        </div>
      ) : null}

      {node.url ? (
        <a
          className="m-4 inline-block text-sm underline"
          href={node.url}
          target="_blank"
          rel="noreferrer"
        >
          Open in {sourceLabel(node.source)}
        </a>
      ) : null}

      <KnowledgeSection attrs={node.attributes} />
    </div>
  );
}

/** Linked docs from unit attrs only — no Confluence provider screen. */
function KnowledgeSection({ attrs }: { attrs: Record<string, string> }) {
  const links = knowledgeLinksFromAttrs(attrs);
  return (
    <div className="border-t border-border px-4 py-3" data-testid="inspector-knowledge">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Knowledge
      </p>
      {links.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No linked docs on this unit.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {links.map((link) => (
            <li key={link.url}>
              <a
                className="text-sm underline"
                href={link.url}
                target="_blank"
                rel="noreferrer"
              >
                {link.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidencePane({ incoming }: { incoming: TraceEdge | null }) {
  if (!incoming) {
    return (
      <p className="px-4 py-5 text-sm text-muted-foreground" data-testid="inspector-evidence">
        No incoming link for this unit.
      </p>
    );
  }

  return (
    <div className="px-4 py-3 text-sm" data-testid="inspector-evidence">
      <p className="font-medium">Linked by {incoming.relation}</p>
      <ConfidenceBadge confidence={incoming.confidence} />
      {incoming.evidence.map((item) => (
        <p key={`${item.kind}:${item.detail}`} className="mt-1 text-muted-foreground">
          {item.kind}: {item.detail}
        </p>
      ))}
    </div>
  );
}

function RuntimePane({
  node,
  runtime,
  onExploreRuntime,
}: {
  node: TraceNode;
  runtime: RuntimeHandoff | null;
  onExploreRuntime?: (target?: RuntimeHandoff) => void;
}): ReactNode {
  const entries = Object.entries(node.attributes);

  return (
    <div data-testid="inspector-runtime">
      {runtime && onExploreRuntime ? (
        <div className="border-b border-border px-4 py-3">
          <Button size="xs" onClick={() => onExploreRuntime(runtime)}>
            Explore in Kubernetes
          </Button>
        </div>
      ) : null}
      <dl className="divide-y divide-border" data-testid="unit-attributes">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">No additional attributes returned.</p>
        ) : null}
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(8rem,1fr)_minmax(0,2fr)] gap-3 px-4 py-2 text-sm"
          >
            <dt className="font-medium">{key}</dt>
            <dd className="overflow-x-auto whitespace-nowrap text-muted-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
