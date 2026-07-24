# Документация разработки P4FNV

В корне `Docs` находятся только живые контракты, которые нужно учитывать при изменении приложения. Исследования и исторические снимки лежат в [`research`](research/README.md) и не являются источником истины.

## Что читать

| Документ | Когда нужен |
|---|---|
| [`TOOLCHAIN.md`](TOOLCHAIN.md) | запуск, тесты и release build |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | IPC, P4 process boundary, состояние и безопасность |
| [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | размещение нового кода и направление зависимостей |
| [`P4_FEATURE_CHECKLIST.md`](P4_FEATURE_CHECKLIST.md) | текущие возможности, приоритеты и Definition of Done |
| [`UI_UX_SPECIFICATION.md`](UI_UX_SPECIFICATION.md) | layout, interaction, accessibility и visual QA |
| [`CHANGELIST_REQUIREMENTS.md`](CHANGELIST_REQUIREMENTS.md) | submit, shelf, unshelve, revert и drag-and-drop |
| [`LOCALIZATION.md`](LOCALIZATION.md) | RU/EN и внешние language packs |
| [`AGENT_DEVELOPMENT.md`](AGENT_DEVELOPMENT.md) | локальный MCP, native UI bridge и автономная проверка |
| [`UX_REWORK_TASK.md`](UX_REWORK_TASK.md) | контракт и приёмочный checklist переработки Files/My Changes/Streams |

## Правило актуальности

- Код и автоматические тесты доказывают текущее поведение; living document фиксирует обязательный контракт и следующий приоритет.
- Изменение архитектуры, пользовательского workflow, локализации или shipping-команд обновляет соответствующий документ в том же изменении.
- Общий обзор, конкурентный анализ, narrative user stories, длинные каталоги возможностей и исторические решения добавляются в `Docs/research`, а не в living contracts.
- Один факт должен иметь одного владельца: feature status — в checklist, UI-правило — в UI/UX, техническая граница — в architecture.
