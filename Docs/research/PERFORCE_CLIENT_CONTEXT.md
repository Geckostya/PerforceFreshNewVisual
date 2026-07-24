# Исходный контекст проекта: визуальный клиент для Perforce Helix Core

> Research snapshot. Документ фиксирует исходные предположения до реализации приложения и не является текущим контрактом разработки.

## Цель

Создать новый кроссплатформенный визуальный клиент для Perforce Helix Core. Клиент должен покрывать основные ежедневные операции разработчика и со временем может приблизиться по возможностям к P4V.

## Принятое техническое направление

Основной стек:

- **Rust** для локального backend и интеграции с Perforce;
- **Tauri** для desktop-оболочки;
- **React или Svelte** для интерфейса — выбрать при создании проекта;
- установленный в системе **`p4` CLI** как основной интерфейс к Helix Core;
- структурированный вывод команд через **`p4 -ztag -Mj`** (JSON Lines).

Предлагаемая схема:

```text
Tauri UI (React/Svelte)
        ↓ Tauri commands + events
Rust backend
        ↓ отдельные процессы p4
p4 -ztag -Mj <command> ...
        ↓
Helix Core Server
```

## Почему выбран этот подход

- API Helix Core достаточно для создания полноценного визуального клиента.
- У Perforce есть официальные API для C/C++, .NET, Java, Python и ряда других языков, но полноценного официального Rust SDK нет.
- Подключение C++ P4API через FFI заметно усложнит сборку, обновления, OpenSSL-совместимость и поддержку платформ.
- `p4` CLI покрывает практически все пользовательские операции и умеет возвращать машиночитаемый результат.
- Отдельный процесс на длительную операцию естественно поддерживает потоковый вывод, прогресс и отмену.
- Rust даёт один компактный backend-бинарник, хорошую кроссплатформенность и строгую проверку ошибок.
- Tauri подходит для лёгкого desktop-клиента и позволяет держать доступ к Perforce в Rust-части, не выставляя произвольный shell frontend-коду.

Не следует основывать основную реализацию на P4 REST API: в Helix Core 2026.1 он всё ещё имеет статус **Technology Preview**, активно меняется и уже содержит breaking changes.

## Главный принцип реализации

Начать с минимального рабочего клиента поверх CLI. Не создавать заранее универсальный SDK, систему плагинов, несколько transport-слоёв или абстракции под будущий REST/P4API.

Переходить на C++ P4API/FFI только при наличии конкретной операции, для которой CLI объективно недостаточен.

## Границы первого MVP

### Подключение

- настройка пути к `p4`;
- `P4PORT`, `P4USER`, `P4CLIENT`;
- проверка соединения через `p4 info`;
- SSL trust;
- `p4 login` и ticket-based authentication;
- выбор существующего workspace/client.

### Просмотр данных

- дерево depot/workspace;
- состояние файлов;
- открытые файлы;
- pending changelists;
- submitted changelists;
- описание changelist;
- история файла;
- diff выбранной ревизии.

### Операции

- sync;
- edit;
- add;
- delete;
- revert;
- создание и редактирование changelist;
- перемещение файлов между changelist'ами;
- submit.

### Команды-кандидаты для первого этапа

```text
info
clients
client -o
fstat
opened
changes
describe
filelog
diff / diff2
sync
edit
add
delete
revert
reopen
change -o / change -i
submit
```

Shelve/unshelve, reconcile, streams, labels, jobs и интерактивный resolve можно добавить после стабильного MVP.

## Предлагаемая минимальная структура

```text
src-tauri/src/
  p4.rs           # безопасный запуск p4 и чтение JSON Lines
  connection.rs   # параметры подключения, окружение, tickets
  commands.rs     # узкие Tauri-команды для UI
  main.rs

src/
  components/
    DepotTree
    Changelists
    FileHistory
    SubmitDialog
```

Структура ориентировочная. Не создавать отдельный файл или слой, пока он не нужен реальному сценарию.

## Требования к запуску `p4`

- Никогда не собирать shell-команду конкатенацией строк.
- Передавать имя команды и аргументы через `Command::args()`.
- Не передавать пароль через аргументы процесса.
- Использовать `p4 login`, tickets и при необходимости системное хранилище секретов.
- Ограничить набор операций, доступных frontend через Tauri commands.
- Не давать frontend произвольно запускать shell-команды.
- Читать stdout построчно: `-Mj` возвращает последовательность JSON-объектов, а не один JSON-массив.
- Раздельно обрабатывать stdout, stderr, exit code, предупреждения и ошибки Perforce.
- Для длительных операций использовать отдельный дочерний процесс и хранить его идентификатор/handle для отмены.
- Учитывать не-UTF-8 имена и содержимое; `-Mj` заменяет невалидные UTF-8 байты символом `U+FFFD`, поэтому файловые пути требуют отдельной проверки.
- Путь к `p4` брать из явной настройки пользователя либо из `PATH`.
- Не включать `p4` в дистрибутив приложения без проверки лицензии и правил распространения Perforce.

## Особенности Helix Core, которые нельзя потерять

- depot path, client path и local filesystem path — разные пространства имён;
- client view может включать, исключать и перенаправлять пути;
- работа с файлами зависит от выбранного workspace;
- один API connection не предназначен для параллельных запросов, однако в CLI-архитектуре каждая команда является отдельным процессом;
- Unicode mode и `P4CHARSET`;
- case-sensitive и case-insensitive серверы/файловые системы;
- commit/edge server topology;
- tickets, SSO, MFA и SSL trust;
- серверные permissions и protections;
- interactive prompts и resolve;
- большие бинарные файлы, долгие sync/submit и отмена операций.

## Предлагаемый первый вертикальный сценарий

Не начинать сразу со всего списка функций. Первый законченный сценарий:

1. Найти `p4` и показать его версию.
2. Ввести `P4PORT`, `P4USER`, `P4CLIENT`.
3. Выполнить `p4 info` и отобразить результат.
4. Получить `p4 opened` и показать открытые файлы.
5. Получить pending changelists.
6. Переместить выбранный файл в changelist через `p4 reopen`.
7. Добавить минимальные тесты парсинга JSON Lines и ошибок процесса.

После этого добавить depot tree, sync и submit.

## Открытые решения

- React или Svelte для UI.
- Требуется ли поддержка только Windows или Windows/macOS/Linux.
- Должен ли клиент использовать только установленный пользователем `p4` или поставлять его отдельно после юридической проверки.
- Насколько близко интерфейс должен повторять P4V.
- Нужна ли поддержка streams уже в первой публичной версии.

## Полезные официальные источники

- [P4 CLI: global options и JSON output](https://help.perforce.com/helix-core/server-apps/cmdref/2025.1/Content/CmdRef/global.options.html)
- [P4 API for C/C++](https://help.perforce.com/helix-core/apis/p4api/current/Content/P4API/Home-p4api.html)
- [P4Python: универсальный `run()` и модель API](https://help.perforce.com/helix-core/apis/p4python/current/Content/P4Python/python.p4.html)
- [P4Java](https://help.perforce.com/helix-core/apis/p4java/current/Content/P4Java/Home-p4java.html)
- [P4 REST API — Technology Preview](https://help.perforce.com/helix-core/server-apps/p4sag/current/Content/P4SAG/p4-rest-api.html)
- [Tauri: запуск внешних бинарников](https://v2.tauri.app/develop/sidecar/)

## Готовая инструкция для нового чата

```text
Используй PERFORCE_CLIENT_CONTEXT.md как исходный контекст проекта.

Нужно создать новый кроссплатформенный desktop-проект визуального клиента для Perforce Helix Core на Tauri + Rust. Основная интеграция с Perforce должна идти через установленный p4 CLI с выводом `-ztag -Mj`. Следуй минимальной архитектуре из документа: не добавляй FFI к C++ P4API, REST, универсальный transport layer или другие абстракции без реальной необходимости.

Сначала проверь окружение и предложи/создай самый маленький вертикальный сценарий: поиск p4, отображение версии, ввод P4PORT/P4USER/P4CLIENT, выполнение p4 info и вывод результата. Все аргументы процессов должны передаваться безопасно без shell-конкатенации. Добавь минимальный тест парсинга результата и ошибок.
```
