# Framing Security Demo

Локальный стенд для демонстрации защиты от clickjacking через `X-Frame-Options` и `Content-Security-Policy: frame-ancestors`.

## Что реализовано

### Часть 1. X-Frame-Options

- `/xfo/admin-panel.html` - защита через `X-Frame-Options: DENY`
- `/xfo/public-widget.html` - защита через `X-Frame-Options: SAMEORIGIN`
- `/xfo/partner-widget.html` - демонстрация `X-Frame-Options: ALLOW-FROM http://localhost:8081`

### Часть 2. CSP frame-ancestors

- `/csp/secure-dashboard.html` - `frame-ancestors 'none'`
- `/csp/embedded-content.html` - `frame-ancestors http://localhost:8081 http://localhost:8083`
- `/csp/self-embedded.html` - `frame-ancestors 'self'`

### Часть 3. Сравнение и анализ

- отчет в `REPORT.md`
- живые результаты браузерного прогона в `browser-test-results.json`
- автоматические сценарии для headless и GUI проверки

## Требования

- Node.js 18+ или новее
- Windows, macOS или Linux для запуска локального сервера
- Для полного GUI-прогона нужны установленные браузеры:
  - Google Chrome
  - Mozilla Firefox
  - Microsoft Edge

## Локальные origins

Сервер поднимает несколько origins, чтобы можно было реально проверить правила встраивания:

- `http://localhost:8080` - main app
- `http://localhost:8081` - trusted partner
- `http://localhost:8082` - attacker
- `http://localhost:8083` - secondary trusted origin

## Как запустить стенд

### 1. Запуск сервера

```powershell
node server.js
```

После старта откройте:

- `http://localhost:8080/` - главная страница стенда
- `http://localhost:8080/tests/xfo-lab.html` - проверка `X-Frame-Options`
- `http://localhost:8080/tests/csp-lab.html` - проверка `frame-ancestors`

### 2. Ручная проверка в браузере

На главной странице есть ссылки для всех локальных origins. Можно открыть:

- XFO lab с same-origin, trusted, attacker и review origins
- CSP lab с same-origin, trusted, attacker и review origins

Лаборатории сами встраивают защищенные страницы в `iframe` и отмечают:

- `PASS`, если фактическое поведение совпало с ожидаемым
- `FAIL`, если поведение отличается

## Автоматические проверки

### Headless smoke-test

Быстрая проверка без гарантии полноценного прогона в каждом браузере:

```powershell
node scripts/run-headless-tests.js
```

Или:

```powershell
npm run test:browsers
```

### Полный GUI-прогон

Открывает реальные окна браузеров с временными профилями и собирает результаты:

```powershell
node scripts/run-browser-tests.js
```

Или:

```powershell
npm run test:browsers:gui
```

Результат сохраняется в:

- `browser-test-results.json`

## Что находится в проекте

- `server.js` - локальный HTTP-сервер и настройка заголовков
- `public/index.html` - главная страница стенда
- `public/xfo/*.html` - сценарии `X-Frame-Options`
- `public/csp/*.html` - сценарии `CSP frame-ancestors`
- `public/tests/*.html` - тестовые iframe-страницы
- `public/assets/*` - общие стили и клиентская логика
- `scripts/run-headless-tests.js` - headless smoke-test
- `scripts/run-browser-tests.js` - живой GUI-прогон
- `REPORT.md` - отчет по сравнению методов и рекомендациям
- `browser-test-results.json` - результаты последнего полного прогона

## Фактический результат браузерного прогона

Проверено 13 апреля 2026 года:

- Chrome `146.0.7680.178`
- Firefox `149.0.2`
- Edge `147.0.3912.60`

Вывод:

- `DENY` работает корректно
- `SAMEORIGIN` работает корректно
- `frame-ancestors` работает корректно
- `ALLOW-FROM` нельзя считать надежной защитой в современных браузерах

Подробности и таблица совместимости находятся в `REPORT.md`.
