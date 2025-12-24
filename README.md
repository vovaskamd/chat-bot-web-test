# chat-bot-web

## Структура

- `server.js` - backend API.
- `frontend/` - статичный фронтенд (открывай `frontend/index.html`).

Чтобы подключить другой фронтенд к API, задай `window.API_BASE` в HTML или через свой сборщик.

## API

- `POST /api/chat` - веб‑чат (JSON).
- `POST /api/twilio` - входящие сообщения от Twilio (form‑urlencoded).

Twilio‑маппинг потоков хранится в `data/twilio_threads.json`.

## KB файлы (data/)

Все файлы `data/kb*.json` загружаются и объединяются при старте.

- `data/kb.json` - ядро: правила, идентичность, услуги, шаблоны ответов.
- `data/kb_faq.json` - FAQ‑факты (массив объектов `{ keywords, facts }`).
- `data/kb_magnets.json` - описание услуги магнитов (без цен).
- `data/kb_geo.json` - география и покрытие.
- `data/kb_magnets_brit_mila.json` - доменный блок для магнитов на брит-мила (в `domains.magnets_brit_mila`).

Правила объединения:
- JSON‑массивы склеиваются (для примитивов есть дедупликация).
- JSON‑объекты мержатся глубоко (вложенные ключи объединяются).
- Если файл KB — это массив, он добавляется в общий пул FAQ‑фактов.
