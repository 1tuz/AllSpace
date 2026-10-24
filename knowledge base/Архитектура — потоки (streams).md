# Архитектура — потоки (streams)

Все длинные операции вынесены в `crates/streams`: это host-agnostic ядра, которые не знают, куда отдавать события. Контракт один — трейт `EventSink` с методом `emit(channel, payload)` в `crates/streams/src/sink.rs`; имена каналов динамические, например `exec:out:exec-3-9f2a`. Реализаций три: `TauriSink` в `apps/desktop/src-tauri/src/sink.rs` шлёт Tauri-события в WebView, `WsSink` в `crates/server/src/ws/hub.rs` отдаёт кадры WebSocket, а TUI складывает их в свою Tokio-шину через `TuiSink` в `apps/tui/src/sink.rs`. Менеджер — один на вид стрима: `WatchManager`, `LogStreamManager`, `ExecManager`, `ForwardManager`, `TerminalManager`, `HelmManager`; каждый владеет своими задачами и умеет `shutdown_all`. В вебе шесть менеджеров собраны в `UserStreams` (`crates/server/src/streams.rs`) на каждого пользователя, чтобы стримы шли только по его кластерам, а `Drop` гасит всё при выходе или вытеснении из кеша. Десктоп поднимает те же менеджеры в Tauri-командах: `exec.rs`, `logs.rs`, `forward.rs`, `helm.rs`, `terminal.rs`, `watch.rs`.

## Связанные заметки

- [[AllSpace]]
- [[Архитектура — слои и путь запроса]]

## Источники

- crates/streams/src/lib.rs
- crates/streams/src/sink.rs
- crates/streams/src/exec.rs
- crates/streams/src/forward.rs
- crates/streams/src/helm.rs
- crates/streams/src/logs.rs
- crates/streams/src/terminal.rs
- crates/streams/src/watch.rs
- apps/desktop/src-tauri/src/sink.rs
- apps/tui/src/sink.rs
- crates/server/src/streams.rs
- crates/server/src/ws/hub.rs