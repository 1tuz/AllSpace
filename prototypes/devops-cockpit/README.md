# DevOps Context Cockpit MVP

Независимый UI-прототип для проверки главной продуктовой гипотезы форка
srelens: единая цепочка `Jira → Bitbucket → Jenkins → Kubernetes`.

## Что работает

- список единиц работы и их текущих ситуаций;
- корреляция по Jira key, commit SHA и container image;
- трасса ticket → PR → build → workload;
- фильтрация и command palette (`Cmd/Ctrl+K`);
- приоритет ситуаций: failed build → degraded rollout → review needed → production;
- тесты чистого correlation engine.

Это намеренно автономный prototype: он запускается без Kubernetes, токенов и
установки зависимостей. Коннекторы пока заменены данными `demo-data.json`.

## Запуск

Требуется Node.js 20+.

```bash
cd prototypes/devops-cockpit
npm test
npm start
```

Открыть `http://127.0.0.1:4173`.

## Следующий технический шаг

Не переносить fetch к Jira/Bitbucket/Jenkins в React. Реальные операции должны
быть Rust capabilities и регистрироваться в общем registry srelens. UI должен
получать уже нормализованные entities и traces. См. `docs/devops-cockpit/`.

