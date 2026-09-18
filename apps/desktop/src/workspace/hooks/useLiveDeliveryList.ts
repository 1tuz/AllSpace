import { useEffect, useState } from "react";
import {
  devopsListDeliveries,
  devopsMyWork,
  type DevOpsDeliveryList,
  type DevOpsProfile,
} from "@srelens/core";
import { summaryToDelivery, type DeliveryListItem } from "../delivery/summaryToDelivery";

export type LiveListKind = "myWork" | "list";

export type LiveDeliveryListState = {
  rows: DeliveryListItem[];
  loading: boolean;
  /** Call failed entirely — not the same as a truthful empty list. */
  error: string | null;
  partial: boolean;
  sourceErrors: { source: string; message: string }[];
};

function contourLabel(profile: DevOpsProfile | null): DeliveryListItem["contour"] {
  const id = profile?.id?.toLowerCase() ?? "";
  if (id.includes("appfarm")) return "AppFarm";
  if (id.includes("komus")) return "Komus";
  return "Custom";
}

/**
 * My Work / Deliveries source. Failures stay in `error` / `sourceErrors`; rows
 * are always provider-backed.
 */
export function useLiveDeliveryList(
  kind: LiveListKind,
  profile: DevOpsProfile | null,
): LiveDeliveryListState {
  const [rows, setRows] = useState<DeliveryListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<LiveDeliveryListState["sourceErrors"]>([]);

  const profileId = profile?.id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetchList =
      kind === "myWork"
        ? devopsMyWork({ profileId, limit: 40 })
        : devopsListDeliveries({ profileId, limit: 40 });

    void fetchList
      .then((list: DevOpsDeliveryList) => {
        if (cancelled) return;
        const contour = contourLabel(profile);
        setRows(list.deliveries.map((s) => summaryToDelivery(s, contour)));
        setPartial(list.partial);
        setSourceErrors(list.sourceErrors);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRows([]);
        setPartial(true);
        setSourceErrors([]);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [kind, profileId, profile]);

  return { rows, loading, error, partial, sourceErrors };
}
