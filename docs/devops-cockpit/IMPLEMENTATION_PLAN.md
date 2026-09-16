# План реализации

## Этап 0 — выполнено в этом архиве

- Изучена архитектура и документация srelens.
- Зафиксированы продуктовые паттерны Salience.
- Создан автономный UI-прототип.
- Реализован и протестирован детерминированный correlation engine на demo data.
- Зафиксирована целевая модель и границы MVP.

## Этап 1 — domain core

1. Создать crate `srelens-devops-model` без сетевых зависимостей.
2. Перенести типы Entity/Edge/Evidence/Trace/Situation.
3. Написать fixtures и unit/property tests на неоднозначные связи.
4. Создать crate `srelens-correlation`.
5. Добавить capability `devops.traceIssue` с fixture repository.
6. Зарегистрировать её и обновить capability catalog.

Exit: MCP и backend возвращают trace на fixture данных; UI ещё не нужен.

## Этап 2 — Jira и Bitbucket

1. Добавить настройки base URL, auth method и project filters.
2. Поддержать Bitbucket Cloud и определить отдельный adapter для Data Center;
   не смешивать их API в одном client.
3. Нормализовать issue, PR, branch и commits.
4. Добавить pagination, rate-limit/backoff и bounded cache.
5. Реализовать `listWork` и `traceIssue`.

Exit: trace `Issue → PR → Commit` работает на реальных read-only accounts.

## Этап 3 — Jenkins

1. Поддержать base URL + username/API token и crumb issuer для будущих writes.
2. Начать с Pipeline/Multibranch jobs.
3. Читать build actions/parameters, SCM revision и artifacts.
4. Извлекать image digest/tag из явных build metadata; console log parsing
   оставить fallback с низкой confidence.

Exit: trace доходит до точного build и artifact.

## Этап 4 — Kubernetes join

1. Переиспользовать существующие list/get capabilities и client cache.
2. Извлекать images из Pod templates и actual Pod statuses.
3. Сопоставлять digest прежде tag; учитывать init/sidecar containers.
4. Открывать существующий srelens workload detail по клику из trace.

Exit: `Jira → PR → Build → prod Deployment` работает end-to-end.

## Этап 5 — UI и MCP

1. Перенести prototype в owning design system srelens.
2. Добавить route identity с cluster/context.
3. Добавить Mission control в navigation и command palette.
4. Отображать exact/heuristic evidence и partial errors.
5. Добавить MCP prompts для stand-up и deployment trace.

## Обязательные проверки каждого PR

```bash
cargo test --workspace
pnpm test
pnpm build
```

Для новых capabilities также:

```bash
UPDATE_CATALOG=1 cargo test -p srelens-registry
```

Не снижать coverage thresholds. Любое изменение начинается с failing test согласно
`CONTRIBUTING.md` upstream проекта.

