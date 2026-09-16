# Задание следующему CMD/AI-агенту

## Контекст

Ты работаешь с форком srelens. Сначала полностью прочитай:

1. `AGENTS.md`
2. `CONTRIBUTING.md`
3. `docs/DEVELOPMENT.md`
4. `docs/devops-cockpit/PRODUCT.md`
5. `docs/devops-cockpit/ARCHITECTURE.md`
6. `docs/devops-cockpit/IMPLEMENTATION_PLAN.md`

Автономный prototype находится в `prototypes/devops-cockpit`. Он является
product/UX spike, а не целевой production architecture.

## Первая задача

Реализуй только Этап 1 из `IMPLEMENTATION_PLAN.md`:

- `crates/devops-model`;
- `crates/correlation`;
- fixture-backed read-only capability `devops.traceIssue`;
- регистрацию capability;
- catalog/e2e coverage updates;
- unit tests до implementation.

Не подключай реальные API на первом PR. Не меняй существующие Kubernetes
capabilities. Не добавляй credentials или UI, пока domain contract не проверен.

## Требуемый результат первого PR

- Вход capability: `{ "issueKey": "OPS-142" }`.
- Выход содержит ordered nodes, edges, confidence/evidence, situations,
  `partial` и `sourceErrors`.
- Payload test использует wire spelling `issueKey`, не Rust spelling.
- Capability аннотирована `read_only`.
- Registry/MCP completeness tests проходят.
- Решение не зависит от Tauri и собирается в web host.

## Ограничения

- Не выполнять сетевые запросы из React.
- Не использовать short SHA как exact match.
- Не превращать ошибку источника в «данных нет».
- Не логировать tokens, Authorization или полные credential URLs.
- Не вводить отдельный MCP server: использовать существующий registry projection.
- Не пытаться сделать SSH/Ansible в MVP.

## Проверка prototype

```bash
cd prototypes/devops-cockpit
npm test
npm start
```

## Решения, которые нужно согласовать с владельцем перед Этапом 2

1. Bitbucket Cloud или Bitbucket Data Center (либо оба отдельными adapters).
2. Jira Cloud или Jira Data Center.
3. Способ идентификации image в Jenkins: digest metadata, artifact file,
   параметр build или только console output.
4. Kubernetes conventions: labels/annotations, которыми workloads уже помечаются
   commit/build metadata.

