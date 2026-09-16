# Результаты изучения исходных проектов

## Salience — референс продукта и интерфейса

Из документации Salience перенесены идеи:

- entities, correlations и situations как основная модель;
- My Work/stand-up как представление работы пользователя;
- Mission: ticket, PR и CI в одном контексте;
- attention-first UI вместо набора несвязанных dashboards;
- command palette, timeline и MCP как равноправные поверхности;
- локальная обработка и осторожная работа с credentials.

Не копируются branding, assets или закрытая реализация Salience. Используется
только публично описанная продуктовая модель.

## srelens — техническая основа

Подтверждено в коде и документации ветки `dev`:

- React 19 + Tauri 2 desktop;
- общий Rust core для desktop и axum web host;
- единый capability registry;
- каждая capability автоматически становится Tauri/Web/MCP surface;
- read/write safety annotations и consent policy;
- Kubernetes browse/edit/apply/delete/scale/restart, logs, exec, debug,
  port-forward, Helm, metrics, CRDs и RBAC preflight;
- extension API 0.1 является declarative и Kubernetes-centric.

## Вывод

srelens подходит как фундамент: Kubernetes IDE переписывать не нужно. Основная
новая ценность форка — connector normalization и correlation graph. В первую
версию входят Bitbucket, Jenkins и Jira; SSH и Ansible отложены.

## Исходные публичные материалы

- https://github.com/srelens/srelens/tree/dev
- https://github.com/srelens/srelens/blob/dev/docs/DEVELOPMENT.md
- https://github.com/srelens/srelens/blob/dev/docs/USAGE.md
- https://github.com/srelens/srelens/blob/dev/docs/MCP.md
- https://github.com/srelens/srelens/tree/dev/docs/extensions
- https://clegginabox.github.io/salience-macos/docs/concepts
- https://clegginabox.github.io/salience-macos/docs/map
- https://clegginabox.github.io/salience-macos/docs/my-work
- https://clegginabox.github.io/salience-macos/docs/mcp

