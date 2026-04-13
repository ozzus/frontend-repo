# Отчет по защите от встраивания

## 1. Реализованные сценарии

### X-Frame-Options

| Страница | Заголовок | Назначение |
| --- | --- | --- |
| `/xfo/admin-panel.html` | `X-Frame-Options: DENY` | Полный запрет встраивания |
| `/xfo/public-widget.html` | `X-Frame-Options: SAMEORIGIN` | Разрешение только для того же origin |
| `/xfo/partner-widget.html` | `X-Frame-Options: ALLOW-FROM http://localhost:8081` | Демонстрация legacy-сценария с одним доверенным origin |

### CSP frame-ancestors

| Страница | Заголовок | Назначение |
| --- | --- | --- |
| `/csp/secure-dashboard.html` | `Content-Security-Policy: frame-ancestors 'none'` | Полный запрет встраивания |
| `/csp/embedded-content.html` | `Content-Security-Policy: frame-ancestors http://localhost:8081 http://localhost:8083` | Разрешение нескольким доверенным origins |
| `/csp/self-embedded.html` | `Content-Security-Policy: frame-ancestors 'self'` | Разрешение только для того же origin |

## 2. Локальная тестовая схема

| Роль | Origin | Назначение |
| --- | --- | --- |
| Main app | `http://localhost:8080` | same-origin сценарии |
| Trusted partner | `http://localhost:8081` | локальный аналог `trusted-partner.com` |
| Attacker | `http://localhost:8082` | негативные проверки |
| Secondary trusted | `http://localhost:8083` | второй доверенный origin для CSP |

## 3. Сравнение методов

| Критерий | X-Frame-Options | CSP frame-ancestors |
| --- | --- | --- |
| Полный запрет встраивания | Да | Да |
| Только same-origin | Да | Да |
| Несколько доверенных origins | Нет | Да |
| Гибкость политики | Низкая | Высокая |
| Актуальность для новых проектов | Низкая | Высокая |
| Надежность точечного allow-list | Плохая из-за `ALLOW-FROM` | Высокая |

## 4. Что проверено локально

13 апреля 2026 года локально подтверждены реальные HTTP-заголовки:

- `admin-panel.html` отдает `X-Frame-Options: DENY`
- `public-widget.html` отдает `X-Frame-Options: SAMEORIGIN`
- `partner-widget.html` отдает `X-Frame-Options: ALLOW-FROM http://localhost:8081`
- `secure-dashboard.html` отдает `Content-Security-Policy ... frame-ancestors 'none'`
- `embedded-content.html` отдает `Content-Security-Policy ... frame-ancestors http://localhost:8081 http://localhost:8083`
- `self-embedded.html` отдает `Content-Security-Policy ... frame-ancestors 'self'`

После этого был выполнен живой GUI-прогон через `scripts/run-browser-tests.js`.

Проверенные браузеры:

- Chrome `146.0.7680.178`
- Firefox `149.0.2`
- Edge `147.0.3912.60`

Результаты сохранены в `browser-test-results.json`.

## 5. Фактические результаты прогона

| Метод | Проверено сценариев | Итог |
| --- | --- | --- |
| `X-Frame-Options` | 36 | 27 совпадений с ожидаемой матрицей, 9 расхождений |
| `CSP frame-ancestors` | 36 | 36 совпадений с ожидаемой матрицей |

### Детальные выводы

1. `DENY` отработал корректно во всех трех браузерах.
2. `SAMEORIGIN` отработал корректно во всех трех браузерах.
3. `frame-ancestors 'none'`, `frame-ancestors 'self'` и список доверенных origins отработали корректно во всех трех браузерах.
4. Все 9 расхождений пришлись только на `ALLOW-FROM`.
5. `partner-widget.html` успешно встраивался не только с trusted origin, но и с `app`, `attacker`, `review` в Chrome, Firefox и Edge.
6. Практический вывод: `ALLOW-FROM` нельзя считать рабочим и безопасным способом ограничения встраивания в современных браузерах.

## 6. Совместимость браузеров

Источники на 13 апреля 2026 года:

- MDN по `X-Frame-Options`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Frame-Options
- MDN по `frame-ancestors`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors
- OWASP Clickjacking Defense Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- Can I use по `X-Frame-Options`: https://caniuse.com/x-frame-options
- Can I use по `frame-ancestors`: https://caniuse.com/mdn-http_headers_content-security-policy_frame-ancestors

| Браузер | Версия | `DENY` / `SAMEORIGIN` | `ALLOW-FROM` | `frame-ancestors` | Вывод |
| --- | --- | --- | --- | --- | --- |
| Chrome | `146.0.7680.178` | Живой тест пройден | Живой тест показал небезопасное поведение вне trusted origin | Живой тест пройден | Использовать CSP |
| Firefox | `149.0.2` | Живой тест пройден | Живой тест показал небезопасное поведение вне trusted origin | Живой тест пройден | Использовать CSP |
| Edge | `147.0.3912.60` | Живой тест пройден | Живой тест показал небезопасное поведение вне trusted origin | Живой тест пройден | Использовать CSP |
| Safari | Не тестировался локально | По документации поддерживается | Ненадежно | По документации поддерживается в современных версиях | Использовать CSP |
| Internet Explorer 11 | Не тестировался локально | Поддерживается | Legacy-only поведение | Не поддерживается | Для legacy возможен только XFO |

## 7. Рекомендации

1. Для новых приложений использовать `Content-Security-Policy: frame-ancestors` как основной механизм.
2. `X-Frame-Options` оставлять только как дополнительный legacy-layer при необходимости поддержки старых браузеров.
3. Не строить защиту на `ALLOW-FROM`: живой прогон показал, что эта директива не дает надежного ограничения.
4. Для критичных страниц применять полный запрет: `DENY` или `frame-ancestors 'none'`.
5. Для same-origin виджетов предпочитать `frame-ancestors 'self'`.
6. Для partner/embed сценариев использовать список доверенных origins через `frame-ancestors`.
