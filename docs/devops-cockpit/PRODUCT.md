# Product brief: DevOps Context Cockpit

## Цель

Расширить srelens из Kubernetes IDE до локального DevOps cockpit, который
отвечает не только «что происходит в кластере», но и «какая работа привела к
этому состоянию».

Основной запрос пользователя:

> Где сейчас задача OPS-142: в review, в Jenkins, на staging или уже в production?

## Целевая цепочка

```text
Jira issue
  ↕ issue key
Bitbucket branch / pull request / commit
  ↕ commit SHA
Jenkins job / build / artifact image
  ↕ image digest, tag or revision label
Kubernetes Deployment / Pod
```

## MVP

Входит:

1. Dashboard «Mission control» с единицами работы.
2. Trace одной задачи через четыре системы.
3. Ситуации: failed build, review needed, rollout degraded, in production.
4. Read-only capabilities для поиска и трассировки.
5. MCP-доступ к тем же read-only операциям.
6. Локальное хранение конфигурации и credentials через существующий vault srelens.

Не входит:

- SSH и Ansible;
- изменение Jira/Bitbucket/Jenkins;
- автоматическое исправление проблем;
- полнотекстовая индексация истории;
- multi-user orchestration;
- универсальная схема для всех CI/CD систем.

## UX-принципы, взятые у Salience

- Работа, а не инструмент, является основной единицей интерфейса.
- Разрозненные entities собираются в correlation graph.
- «Ситуации» поднимают то, что требует внимания; dashboard не превращается в
  стену метрик.
- Интерфейс glanceable: состояние читается без открытия каждой системы.
- Command palette и клавиатурная навигация являются основным быстрым путём.
- Агент получает тот же нормализованный контекст через MCP.

## UX-принципы, сохранённые из srelens

- Три плотных, независимых региона без карточной сетки и page scroll.
- Cluster hotbar и resource navigation остаются знакомыми.
- Kubernetes detail/actions не дублируются: cockpit открывает существующие
  workload, logs, exec, YAML и scale экраны.
- Цвет никогда не является единственным признаком статуса.
- Любая мутация остаётся confirmation-gated и проверяется Kubernetes RBAC.

## Критерии готовности первой реальной версии

- OPS/Jira key находит PR с точностью, достаточной для ежедневного использования.
- Commit из merged PR связывается с Jenkins build и image digest.
- Image digest или revision label связывает build с workload в выбранном cluster.
- Пользователь видит происхождение каждой связи и может отличить точное совпадение
  от эвристики.
- MCP отвечает на `trace_issue`, `trace_commit`, `trace_deployment` без доступа к
  исходным credentials.
- Ошибка одной интеграции отображается как partial trace, а не как отсутствие данных.

