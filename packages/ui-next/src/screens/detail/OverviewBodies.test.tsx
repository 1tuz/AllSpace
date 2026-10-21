import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { K8sObject } from "@srelens/core";
import { EndpointsDetailsBody, EndpointSliceDetailsBody } from "./EndpointsBody";
import { HpaDetailsBody } from "./HpaBody";
import { IngressDetailsBody } from "./IngressBody";
import { IngressClassDetailsBody } from "./IngressClassBody";
import { LeaseDetailsBody } from "./LeaseBody";
import { LimitRangeDetailsBody } from "./LimitRangeBody";
import { NetworkPolicyDetailsBody } from "./NetworkPolicyBody";
import { PdbDetailsBody } from "./PdbBody";
import { PriorityClassDetailsBody } from "./PriorityClassBody";
import { PersistentVolumeDetailsBody, PvcDetailsBody } from "./PvcBody";
import { ResourceQuotaDetailsBody } from "./ResourceQuotaBody";
import { RoleBindingDetailsBody, RoleDetailsBody } from "./RoleBody";
import { RuntimeClassDetailsBody } from "./RuntimeClassBody";
import { ServiceAccountDetailsBody } from "./ServiceAccountBody";
import { StorageClassDetailsBody } from "./StorageClassBody";
import { WebhookDetailsBody } from "./WebhookBody";

function obj(
  kind: string,
  spec: Record<string, unknown> = {},
  status: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): K8sObject {
  return {
    kind,
    apiVersion: "v1",
    metadata: { name: "obj-1", namespace: "default" },
    spec,
    status,
    ...extra,
  } as K8sObject;
}

describe("IngressDetailsBody", () => {
  it("shows class, TLS hosts/secrets, and rule rows", () => {
    render(
      <IngressDetailsBody
        object={obj("Ingress", {
          ingressClassName: "nginx",
          tls: [{ hosts: ["app.example"], secretName: "app-tls" }],
          rules: [
            {
              host: "app.example",
              http: {
                paths: [
                  {
                    path: "/api",
                    backend: { service: { name: "api", port: { number: 8080 } } },
                  },
                ],
              },
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("nginx")).toBeDefined();
    expect(screen.getByText("app.example", { selector: ".kv-v" })).toBeDefined();
    expect(screen.getByText("Secret/app-tls")).toBeDefined();
    expect(screen.getByText("/api")).toBeDefined();
    expect(screen.getByText("api:8080")).toBeDefined();
  });

  it("omits the Rules section when there are no rules", () => {
    render(<IngressDetailsBody object={obj("Ingress", { ingressClassName: "nginx" })} />);
    expect(screen.queryByRole("heading", { name: "Rules" })).toBeNull();
  });
});

describe("PvcDetailsBody", () => {
  it("shows phase, capacity, access modes, storage class and bound volume", () => {
    render(
      <PvcDetailsBody
        object={obj(
          "PersistentVolumeClaim",
          {
            accessModes: ["ReadWriteOnce", "ReadOnlyMany"],
            storageClassName: "fast",
            volumeName: "pv-1",
          },
          { phase: "Bound", capacity: { storage: "10Gi" } },
        )}
      />,
    );
    expect(screen.getByText("Bound")).toBeDefined();
    expect(screen.getByText("10Gi")).toBeDefined();
    expect(screen.getByText("ReadWriteOnce, ReadOnlyMany")).toBeDefined();
    expect(screen.getByText("StorageClass/fast")).toBeDefined();
    expect(screen.getByText("PersistentVolume/pv-1")).toBeDefined();
  });
});

describe("PersistentVolumeDetailsBody", () => {
  it("shows reclaim policy, source, storage class and claim", () => {
    render(
      <PersistentVolumeDetailsBody
        object={obj(
          "PersistentVolume",
          {
            capacity: { storage: "20Gi" },
            accessModes: ["ReadWriteOnce"],
            persistentVolumeReclaimPolicy: "Retain",
            volumeMode: "Filesystem",
            csi: { driver: "ebs.csi.aws.com" },
            storageClassName: "fast",
            claimRef: { namespace: "default", name: "data" },
          },
          { phase: "Bound" },
        )}
      />,
    );
    expect(screen.getByText("Bound")).toBeDefined();
    expect(screen.getByText("20Gi")).toBeDefined();
    expect(screen.getByText("Retain")).toBeDefined();
    expect(screen.getByText("Filesystem")).toBeDefined();
    expect(screen.getByText("CSI")).toBeDefined();
    expect(screen.getByText("StorageClass/fast")).toBeDefined();
    expect(screen.getByText("PersistentVolumeClaim/default/data")).toBeDefined();
  });
});

describe("HpaDetailsBody", () => {
  it("shows scale target, replica counts and min/max", () => {
    render(
      <HpaDetailsBody
        object={obj(
          "HorizontalPodAutoscaler",
          { scaleTargetRef: { kind: "Deployment", name: "web" }, minReplicas: 1, maxReplicas: 10 },
          { currentReplicas: 3, desiredReplicas: 5 },
        )}
      />,
    );
    expect(screen.getByText("Deployment/web")).toBeDefined();
    expect(screen.getByText("3 current / 5 desired")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
  });
});

describe("NetworkPolicyDetailsBody", () => {
  it("shows selector, policy types and rule counts", () => {
    render(
      <NetworkPolicyDetailsBody
        object={obj("NetworkPolicy", {
          podSelector: { matchLabels: { app: "web" } },
          policyTypes: ["Ingress", "Egress"],
          ingress: [{}],
          egress: [{}, {}],
        })}
      />,
    );
    expect(screen.getByText("web")).toBeDefined();
    expect(screen.getByText("Ingress, Egress")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("2")).toBeDefined();
  });

  it("says all pods when the selector is empty", () => {
    render(
      <NetworkPolicyDetailsBody
        object={obj("NetworkPolicy", { podSelector: {}, policyTypes: ["Ingress"] })}
      />,
    );
    expect(screen.getByText("all pods")).toBeDefined();
  });
});

describe("ServiceAccountDetailsBody", () => {
  it("shows secrets, image pull secrets and automount", () => {
    render(
      <ServiceAccountDetailsBody
        object={obj(
          "ServiceAccount",
          {},
          {},
          {
            secrets: [{ name: "sa-token" }],
            imagePullSecrets: [{ name: "regcred" }],
            automountServiceAccountToken: false,
          },
        )}
      />,
    );
    expect(screen.getByText("Secret/sa-token")).toBeDefined();
    expect(screen.getByText("Secret/regcred")).toBeDefined();
    expect(screen.getByText("No")).toBeDefined();
  });

  it("defaults automount to Yes when unset", () => {
    render(<ServiceAccountDetailsBody object={obj("ServiceAccount")} />);
    expect(screen.getByText("Yes")).toBeDefined();
  });
});

describe("ResourceQuotaDetailsBody", () => {
  it("shows used/hard rows with a usage meter", () => {
    render(
      <ResourceQuotaDetailsBody
        object={obj("ResourceQuota", {}, { hard: { pods: "10", cpu: "4" }, used: { pods: "5", cpu: "1" } })}
      />,
    );
    expect(screen.getByText("pods")).toBeDefined();
    expect(screen.getByText("5")).toBeDefined();
    expect(screen.getByText("10")).toBeDefined();
    expect(screen.getByRole("meter", { name: "pods usage" })).toBeDefined();
    expect(screen.getByRole("meter", { name: "cpu usage" })).toBeDefined();
  });

  it("shows an empty state when status.hard is absent", () => {
    render(<ResourceQuotaDetailsBody object={obj("ResourceQuota")} />);
    expect(screen.getByText("No quota")).toBeDefined();
  });
});

describe("PdbDetailsBody", () => {
  it("shows min/max availability and healthy counts", () => {
    render(
      <PdbDetailsBody
        object={obj(
          "PodDisruptionBudget",
          { minAvailable: "50%", maxUnavailable: 1 },
          { currentHealthy: 3, desiredHealthy: 4, disruptionsAllowed: 0 },
        )}
      />,
    );
    expect(screen.getByText("50%")).toBeDefined();
    expect(screen.getByText("1")).toBeDefined();
    expect(screen.getByText("3 / 4")).toBeDefined();
    expect(screen.getByText("0")).toBeDefined();
  });
});

describe("EndpointsDetailsBody", () => {
  it("shows addresses, ports and inert targets", () => {
    render(
      <EndpointsDetailsBody
        object={obj("Endpoints", {}, {}, {
          subsets: [
            {
              addresses: [{ ip: "10.0.0.1", targetRef: { kind: "Pod", name: "web-0", namespace: "default" } }],
              ports: [{ name: "http", port: 80, protocol: "TCP" }],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText("10.0.0.1")).toBeDefined();
    expect(screen.getByText("http: 80/TCP")).toBeDefined();
    expect(screen.getByText("Pod/default/web-0")).toBeDefined();
  });

  it("says None when there are no addresses", () => {
    render(<EndpointsDetailsBody object={obj("Endpoints")} />);
    expect(screen.getByText("None")).toBeDefined();
  });
});

describe("EndpointSliceDetailsBody", () => {
  it("shows address type, addresses, ports and targets", () => {
    render(
      <EndpointSliceDetailsBody
        object={obj("EndpointSlice", {}, {}, {
          addressType: "IPv4",
          endpoints: [{ addresses: ["10.0.0.2"], targetRef: { kind: "Pod", name: "web-1" } }],
          ports: [{ port: 8080, protocol: "TCP" }],
        })}
      />,
    );
    expect(screen.getByText("IPv4")).toBeDefined();
    expect(screen.getByText("10.0.0.2")).toBeDefined();
    expect(screen.getByText("8080/TCP")).toBeDefined();
    expect(screen.getByText("Pod/default/web-1")).toBeDefined();
  });
});

describe("RoleDetailsBody", () => {
  it("shows rule rows for api groups, resources and verbs", () => {
    render(
      <RoleDetailsBody
        object={obj("Role", {}, {}, {
          rules: [{ apiGroups: [""], resources: ["pods"], verbs: ["get", "list"] }],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Rules (1)" })).toBeDefined();
    expect(screen.getByText("pods")).toBeDefined();
    expect(screen.getByText("get, list")).toBeDefined();
  });

  it("shows empty state when there are no rules", () => {
    render(<RoleDetailsBody object={obj("ClusterRole")} />);
    expect(screen.getByText("No rules")).toBeDefined();
  });
});

describe("RoleBindingDetailsBody", () => {
  it("shows role ref and ServiceAccount subjects as inert Kind text", () => {
    render(
      <RoleBindingDetailsBody
        object={obj("RoleBinding", {}, {}, {
          roleRef: { kind: "Role", name: "edit" },
          subjects: [{ kind: "ServiceAccount", name: "builder" }],
        })}
      />,
    );
    expect(screen.getByText("Role")).toBeDefined();
    expect(screen.getByText("Role/default/edit")).toBeDefined();
    expect(screen.getByText("ServiceAccount/default/builder")).toBeDefined();
  });

  it("omits Subjects when the binding has none", () => {
    render(
      <RoleBindingDetailsBody
        object={obj("ClusterRoleBinding", {}, {}, {
          roleRef: { kind: "ClusterRole", name: "view" },
        })}
      />,
    );
    expect(screen.getByText("ClusterRole/view")).toBeDefined();
    expect(screen.queryByRole("heading", { name: /^Subjects/ })).toBeNull();
  });
});

describe("PriorityClassDetailsBody", () => {
  it("shows value, global default and preemption", () => {
    render(
      <PriorityClassDetailsBody
        object={obj("PriorityClass", {}, {}, {
          value: 1000,
          globalDefault: true,
          preemptionPolicy: "Never",
        })}
      />,
    );
    expect(screen.getByText("1000")).toBeDefined();
    expect(screen.getByText("Yes")).toBeDefined();
    expect(screen.getByText("Never")).toBeDefined();
  });
});

describe("StorageClassDetailsBody", () => {
  it("shows provisioner, reclaim, binding mode and expansion", () => {
    render(
      <StorageClassDetailsBody
        object={obj("StorageClass", {}, {}, {
          provisioner: "ebs.csi.aws.com",
          reclaimPolicy: "Retain",
          volumeBindingMode: "Immediate",
          allowVolumeExpansion: true,
        })}
      />,
    );
    expect(screen.getByText("ebs.csi.aws.com")).toBeDefined();
    expect(screen.getByText("Retain")).toBeDefined();
    expect(screen.getByText("Immediate")).toBeDefined();
    expect(screen.getByText("Yes")).toBeDefined();
  });
});

describe("RuntimeClassDetailsBody", () => {
  it("shows the handler", () => {
    render(<RuntimeClassDetailsBody object={obj("RuntimeClass", {}, {}, { handler: "runsc" })} />);
    expect(screen.getByText("runsc")).toBeDefined();
  });
});

describe("IngressClassDetailsBody", () => {
  it("shows the controller", () => {
    render(
      <IngressClassDetailsBody object={obj("IngressClass", { controller: "k8s.io/ingress-nginx" })} />,
    );
    expect(screen.getByText("k8s.io/ingress-nginx")).toBeDefined();
  });
});

describe("LimitRangeDetailsBody", () => {
  it("shows limit types and constraint keys present on the object", () => {
    render(
      <LimitRangeDetailsBody
        object={obj("LimitRange", {
          limits: [{ type: "Container", default: { cpu: "100m" }, max: { memory: "1Gi" }, min: { cpu: "10m" } }],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Limits (1)" })).toBeDefined();
    expect(screen.getByText("Container")).toBeDefined();
    expect(screen.getByText("cpu, memory")).toBeDefined();
  });

  it("shows empty state when there are no limits", () => {
    render(<LimitRangeDetailsBody object={obj("LimitRange")} />);
    expect(screen.getByText("None")).toBeDefined();
  });
});

describe("LeaseDetailsBody", () => {
  it("shows holder, duration and renew age", () => {
    render(
      <LeaseDetailsBody
        object={obj("Lease", {
          holderIdentity: "node-a",
          leaseDurationSeconds: 15,
          renewTime: "2026-08-20T00:00:00Z",
        })}
      />,
    );
    expect(screen.getByText("node-a")).toBeDefined();
    expect(screen.getByText("15s")).toBeDefined();
    expect(screen.getByText(/ago$/)).toBeDefined();
  });
});

describe("WebhookDetailsBody", () => {
  it("lists webhook names", () => {
    render(
      <WebhookDetailsBody
        object={obj("MutatingWebhookConfiguration", {}, {}, {
          webhooks: [{ name: "mutate.example.com" }, { name: "mutate2.example.com" }],
        })}
      />,
    );
    expect(screen.getByRole("heading", { name: "Webhooks (2)" })).toBeDefined();
    expect(screen.getByText("mutate.example.com")).toBeDefined();
    expect(screen.getByText("mutate2.example.com")).toBeDefined();
  });

  it("shows empty state when there are no webhooks", () => {
    render(<WebhookDetailsBody object={obj("ValidatingWebhookConfiguration")} />);
    expect(screen.getByText("None")).toBeDefined();
  });
});
