# Исследование размеров и визуальной согласованности UI

Дата: 22 июля 2026 года. Это обоснование решений; обязательный актуальный контракт находится в [`../UI_UX_SPECIFICATION.md`](../UI_UX_SPECIFICATION.md).

## Проблема исходного интерфейса

Аудит `src/app/app.css` обнаружил несвязанную шкалу: пользовательский текст задавался размерами от 8 до 25 px, кнопки — высотой 25, 28, 30, 32, 34, 36 и 38 px. В Files строка файла имела высоту 52 px, а строка папки того же дерева — 34 px. History в inspector использовала 10 px, metadata Streams и CLI log — 9 px, отдельные badges — 8 px. Концептуально одинаковые элементы поэтому выглядели как компоненты разных продуктов, а важная история читалась хуже второстепенных controls.

## Внешние ориентиры

- [Fluent 2 Typography](https://fluent2.microsoft.design/typography) задаёт Windows ramp 12/16 px для Caption, 14/20 px для Body, 20/28 px для Subtitle и 28/36 px для Title. Это опора для семантических ролей, а не повод использовать все ступени одновременно.
- [Microsoft Windows typography](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/typography) рекомендует Segoe UI Variable и подчёркивает иерархию и читаемость. P4FNV уже использует корректный Windows font stack.
- [Windows content layout and spacing](https://learn.microsoft.com/en-us/windows/apps/design/basics/content-basics) группирует интерфейс устойчивыми интервалами 8, 12 и 16 effective px и рекомендует Body для основного текста списков, Caption — только для тесных вторичных мест.
- [WCAG 2.2 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) устанавливает floor 24×24 CSS px либо требует достаточный spacing. Для desktop UI P4FNV принят более предсказуемый минимум 32 px для соседних controls.
- [WCAG 2.2 Resize Text](https://www.w3.org/TR/WCAG22/#resize-text) требует сохранять содержимое и функции при увеличении текста до 200%; поэтому плотность нельзя обеспечивать микрошрифтом и фиксированными тесными контейнерами.

## Принятое решение

P4FNV использует небольшую семантическую систему, адаптированную к плотному Windows desktop client:

1. Typography: Caption 12/16, Body 14/20, Subtitle 16/22, Title 20/28, Display 28/36 px.
2. Geometry: controls 32/36 px; list/tree rows 44 px для одной строки и 52 px для двух строк.
3. Spacing: 4 px base с рабочими шагами 4, 8, 12, 16, 24 и 32 px.
4. Одинаковая роль означает одинаковую геометрию. Файл и папка одного дерева различаются смысловыми affordances, но не типографикой и плотностью.
5. 10 px остаётся только для коротких badges, где текст дублирует более явный статус. Вся читаемая metadata начинается с 12 px.

## Почему не добавлен UI framework

Проект уже имеет общие selectors и один CSS entry point. Токены устраняют расхождения без зависимости, миграции компонентов и изменения DOM. Это также сохраняет текущую локализацию, keyboard behavior и Tauri/WebView2 boundary.

## Критерии проверки

- Files: folder/file rows воспринимаются одним деревом, имеют одинаковую высоту и базовую линию.
- History: описание ревизии читается как Body, metadata — как Caption.
- Controls: adjacent buttons не меньше 32 px; обычные поля и primary actions — 36 px.
- Screens: RU/EN, 100/125/200%, минимальное окно; нет clipping, потери действий или горизонтального scroll всей страницы.
- CSS audit: новые feature styles используют tokens вместо новых локальных шкал.
