# Архитектура — capability registry

Capability — единица бэкенд-операции: id, аннотации и async-обработчик; регистрация происходит ровно в одном месте — `build_registry_with_paths` в `crates/registry/src/lib.rs`. Один и тот же реестр отдают три поверхности: Tauri-команда `invoke_capability`, HTTP-эндпоинт `POST /api/capability/:id` веб-сервера и MCP-сервер из `crates/mcp`, который публикует каждый id как инструмент. Инвариант «каждая capability видна в MCP» держит тест `every_capability_is_mcp_exposed` в `crates/registry/src/lib.rs`. Правило аннотаций: любая мутирующая capability (`read_only == false`) обязана быть подтверждаемой (`requires_confirm == true`); это проверяет `assert_mutating_capabilities_are_gated` в `crates/mcp/src/completeness.rs`, а MCP дополнительно спрашивает согласие в рантайме через `McpServer::requires_confirm`. Снимок реестра лежит в `packages/core/src/lib/capability-catalog.json` (136 записей) и сверяется тестом `capability_catalog_json_is_in_sync`; документацию MCP в `docs/mcp-catalog.md` проверяет `mcp_catalog_md_is_in_sync`. После добавления capability каталог перегенерируют командой `UPDATE_CATALOG=1 cargo test -p srelens-registry` и коммитят оба файла. Пошаговый сценарий добавления — в `docs/DEVELOPMENT.md`.

## Связанные заметки

- [[AllSpace]]
- [[Архитектура — краты и их зоны ответственности]]

## Источники

- crates/registry/src/lib.rs
- crates/registry/src/mcp_docs.rs
- crates/capability/src/annotations.rs
- crates/capability/src/lib.rs
- crates/mcp/src/completeness.rs
- crates/mcp/src/lib.rs
- packages/core/src/lib/capability-catalog.json
- docs/mcp-catalog.md
- docs/DEVELOPMENT.md