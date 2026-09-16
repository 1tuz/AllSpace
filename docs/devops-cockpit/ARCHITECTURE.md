# Архитектура

## База

Форк основан на `srelens/srelens`, ветка `dev`, исходный commit
`01f2f56885e1a46182246bc47cc787e1245db2a9`.

srelens уже предоставляет:

- Tauri 2 desktop host и React UI;
- web host на axum и TUI;
- Rust capability registry как единый backend contract;
- автоматическую публикацию capabilities в desktop, web API и MCP;
- Kubernetes operations, streams, logs, exec, port-forward, Helm и metrics;
- safety annotations и MCP consent policy;
- ранний declarative extension host.

## Почему не extension в текущем API

Текущий extension API ориентирован на декларативные Kubernetes-приложения. Он
может связывать UI contributions с разрешёнными host capabilities, но не даёт
произвольному расширению безопасно выполнять HTTP-запросы к Bitbucket, Jenkins
и Jira. Для MVP внешние коннекторы рациональнее реализовать как native Rust
crates/capabilities в форке. Вынесение в extension возможно после появления
host-owned HTTP/credential broker.

## Предлагаемая структура

```text
crates/
  devops-model/       Entity, Evidence, Edge, Trace, Situation
  bitbucket/          REST client + normalization
  jenkins/            REST client + normalization
  jira/               REST client + normalization
  correlation/        deterministic edges and trace queries
  registry/           registers connector and trace capabilities
packages/core/
  src/devops/          typed frontend wrappers
apps/desktop/src/
  components/devops/  Mission control, My work, Trace detail
```

## Нормализованная модель

```rust
Entity {
  id: String,             // source-scoped stable id
  kind: EntityKind,       // Issue, PullRequest, Commit, Build, Artifact, Workload
  source: Source,
  title: String,
  url: Option<String>,
  observed_at: DateTime,
  attributes: JsonValue,
}

Edge {
  from: EntityId,
  to: EntityId,
  relation: Relation,
  confidence: Exact | Strong | Heuristic,
  evidence: Vec<Evidence>,
}
```

Связь без `evidence` запрещена. Примеры evidence:

- `issue_key_in_branch`;
- `build_commit_exact`;
- `image_digest_exact`;
- `kubernetes_revision_label`;
- `image_tag_short_sha` (эвристика).

## Capabilities первого этапа

```text
devops.listWork                 read-only
devops.traceIssue               read-only
devops.traceCommit              read-only
devops.traceDeployment          read-only
bitbucket.listPullRequests      read-only
jenkins.listBuilds              read-only
jira.searchIssues               read-only
```

Wire fields обязаны быть `camelCase` и явно отражаться через `serde(rename)` там,
где Rust field отличается. Каждая capability сначала получает handler test,
после чего регистрируется в `crates/registry` и добавляется в e2e coverage map.

## Корреляция

Порядок источников истинности:

1. Точный image digest.
2. Полный commit SHA из Jenkins metadata или OCI label.
3. Kubernetes revision/deployment annotations.
4. Jira key в branch/PR/build name.
5. Short SHA в image tag — только heuristic.

При конфликте связи не перезаписываются: trace возвращает альтернативы и
evidence. Сбой API возвращает `partial=true` и `sourceErrors`, а не пустой список.

## Credentials и безопасность

- Credentials хранятся через существующий encrypted vault srelens.
- UI не получает secret/token.
- Логи редактируют Authorization headers и query secrets.
- Коннекторы по умолчанию read-only.
- Запись в Jira/Bitbucket/Jenkins — отдельный будущий scope и `requires_confirm`.
- Web mode требует per-user connector configuration; нельзя использовать один
  общий credential для всех пользователей без явной административной модели.

