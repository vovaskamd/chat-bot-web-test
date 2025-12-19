const path = require("path");
const fs = require("fs");
const express = require("express");
const dotenv = require("dotenv");
const { google } = require("googleapis");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_API_BASE = process.env.OPENAI_BASE || "https://api.openai.com/v1";
let ASSISTANT_ID = process.env.ASSISTANT_ID;
let assistantSynced = false;
let KB = [];
let KANBAN = {};
let calendarAuth = null;
const LEADS_PATH = path.join(__dirname, "leads.jsonl");
const LOG_PATH = path.join(__dirname, "logs.jsonl");
const THREADS_DIR = path.join(__dirname, "threads");
const KB_PATH = path.join(__dirname, "data", "kb.json");
const KANBAN_PATH = path.join(__dirname, "data", "kanban.json");
const GOOGLE_CREDENTIALS_PATH = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const CALENDAR_ID = process.env.CALENDAR_ID;

if (!OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env");
  process.exit(1);
}

const SYSTEM_PROMPT = `
Ты — צוות ארגמן, операционный ассистент ивент-бизнеса.
Ты общаешься как живой менеджер в WhatsApp: коротко, спокойно, без официоза.

1) Идентичность и честность
- Представляйся: צוות ארגמן.
- Не выдавай себя за конкретного человека.
- Если прямо спрашивают: ты автоматизированный ассистент команды.
- Тон: разговорный, уверенный, без жаргона и без формальных оборотов.

2) Основной контекст
- Выездные услуги по Израилю (в основном от Хайфы до Беэр-Шевы).
- Арабский сектор — не обслуживаем.
- Офиса нет.
- Клиент покупает готовый результат к началу события без своего участия.

3) Твоя роль
Ты ведёшь первичный контакт и закрытие лида по правилам.
Фиксируешь данные и решения в CRM.
Нельзя хамить, давить, выдумывать условия и выходить за рамки правил.

4) СТИЛЬ (обязательно)
- 1 сообщение = 1–2 коротких предложения.
- Максимум 1 вопрос в сообщении.
- По умолчанию без эмоджи (иногда можно 1 шт).

5) ЖЁСТКИЙ ЗАПРЕТ НА РЕЗЮМЕ (anti-recap)
- Никогда не повторяй клиенту его данные (город/дата/гости/тип события) в виде резюме.
- Запрещены фразы типа: "אז יש לנו", "אוכל לאשר", "תודה על המידע, יש לי כעת", "כלומר", "נכון ש".
- Допустимо повторить данные ТОЛЬКО если клиент сам исправляет или есть явное противоречие (две даты/города).
- Вместо повтора: "מעולה." / "סגור." / "הבנתי." и сразу следующий шаг.

6) Услуги
- מגנטים, בלונים, פוטובוקס, צילום ללא מגנטים.
- Можно продавать отдельно.
- Лучший апселл: מגנטים + בלונים.
- מגנטים без съёмки не существуют.

7) TEST PRICING (только для теста)
Эти цены вымышленные и используются только для прогона диалогов:
- רק מגנטים: 2,500 ₪
- בלונים בסיסי: 2,200 ₪
- מגנטים + בלונים: 4,200 ₪ (ביחד יותר משתלם)
Ты можешь озвучивать эти цены сразу в стандартных кейсах.

8) Диалог (как действовать)
- Если запрос общий: спроси 1 ключевой параметр (обычно дата или город).
- Если клиент отвечает частями: не резюмируй, просто продолжай.
- Когда дата+город+услуга понятны: озвучь цену и предложи пакет (если уместно).
- Если клиент торгуется: оставайся в рамках пакета/вилки, без оправданий и без длинных объяснений.
- Если запрос нестандартный или ты сомневаешься: "תן לי רגע לבדוק ואחזור אליך." и NEED_HUMAN.
- Не проси контактные данные, если диалог уже идёт в чате.

9) Конкуренты
- Спокойно, без оправданий.
- Не демпингуй.
- Можно вежливо отпустить лида, если ожидания не совпадают.

Главное: звучать как человек. Никаких анкет. Никаких резюме.
`.trim();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname), { extensions: ["html"] }));

const toChatMessages = (messages = []) =>
  messages
    .slice(-12)
    .map((msg) => ({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: String(msg.content || "").slice(0, 1500)
    }))
    .filter((msg) => msg.content);

const openAIHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${OPENAI_API_KEY}`,
  "OpenAI-Beta": "assistants=v2"
};

const logEvent = async (record = {}) => {
  try {
    const entry = { ...record, timestamp: new Date().toISOString() };
    await fs.promises.appendFile(LOG_PATH, `${JSON.stringify(entry)}\n`);
  } catch (err) {
    console.error("Log write error:", err);
  }
};

const ensureFiles = async () => {
  try {
    await Promise.all([
      fs.promises.open(LOG_PATH, "a"),
      fs.promises.open(LEADS_PATH, "a"),
      fs.promises.mkdir(THREADS_DIR, { recursive: true })
    ]);
    const kbRaw = await fs.promises.readFile(KB_PATH, "utf8").catch(() => "[]");
    KB = JSON.parse(kbRaw);
    const kbKanban = await fs.promises.readFile(KANBAN_PATH, "utf8").catch(() => "{}");
    KANBAN = JSON.parse(kbKanban);
  } catch (err) {
    console.error("Ensure files error:", err);
  }
};

const threadFilePath = (threadId) => path.join(THREADS_DIR, `${threadId}.txt`);

const writeThreadLine = async (threadId, line) => {
  if (!threadId) return;
  const entry = `[${new Date().toISOString()}] ${line}\n`;
  try {
    await fs.promises.appendFile(threadFilePath(threadId), entry);
  } catch (err) {
    console.error("Thread file write error:", err);
  }
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCalendarAuth = async () => {
  if (!GOOGLE_CREDENTIALS_PATH) {
    throw new Error("missing GOOGLE_APPLICATION_CREDENTIALS");
  }
  if (!calendarAuth) {
    calendarAuth = new google.auth.GoogleAuth({
      keyFile: GOOGLE_CREDENTIALS_PATH,
      scopes: ["https://www.googleapis.com/auth/calendar"]
    });
  }
  return calendarAuth;
};

const getCalendarClient = async () => {
  const auth = await getCalendarAuth();
  return google.calendar({ version: "v3", auth });
};

const createAssistant = async () => {
  const response = await fetch(`${OPENAI_API_BASE}/assistants`, {
    method: "POST",
    headers: openAIHeaders,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT,
      name: "Antigravity Web Chat Bot"
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`assistant_create_failed:${response.status}:${text}`);
  }

  const data = await response.json();
  return data.id;
};

const updateAssistant = async (id) => {
  const response = await fetch(`${OPENAI_API_BASE}/assistants/${id}`, {
    method: "POST",
    headers: openAIHeaders,
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT,
      name: "Antigravity Web Chat Bot"
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`assistant_update_failed:${response.status}:${text}`);
  }
};

const ensureAssistant = async () => {
  if (ASSISTANT_ID) {
    if (!assistantSynced) {
      try {
        await updateAssistant(ASSISTANT_ID);
        assistantSynced = true;
      } catch (err) {
        console.error("Assistant sync failed, recreating:", err);
        const created = await createAssistant();
        ASSISTANT_ID = created;
        assistantSynced = true;
        console.log(`Assistant recreated: ${ASSISTANT_ID} (set ASSISTANT_ID in .env to reuse)`);
      }
    }
    return ASSISTANT_ID;
  }
  const created = await createAssistant();
  ASSISTANT_ID = created;
  assistantSynced = true;
  console.log(`Assistant created: ${ASSISTANT_ID} (set ASSISTANT_ID in .env to reuse)`);
  return ASSISTANT_ID;
};

const readLogs = async ({ threadId = null, limit = 200 } = {}) => {
  const raw = await fs.promises.readFile(LOG_PATH, "utf8").catch(() => "");
  const lines = raw.split("\n").filter(Boolean);
  const entries = [];
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i -= 1) {
    try {
      const parsed = JSON.parse(lines[i]);
      if (threadId && parsed.threadId !== threadId) continue;
      entries.push(parsed);
    } catch (err) {
      // skip bad line
    }
  }
  return entries;
};

const searchKb = (query, limit = 3) => {
  const q = (query || "").toLowerCase();
  const facts = [];

  if (Array.isArray(KB)) {
    KB.forEach((item) => {
      const hit = item.keywords?.some((kw) => q.includes(kw));
      if (hit) {
        item.facts?.forEach((fact) => {
          if (facts.length < limit && !facts.includes(fact)) facts.push(fact);
        });
      }
    });
  } else if (KB && typeof KB === "object") {
    const pricing = KB.pricing?.items || {};
    const services = KB.services?.list;
    if (services?.length && /מגנט|магнит|magnet|בלונ|balloon|פוטו|צילום/.test(q)) {
      facts.push(`שירותים: ${services.join(", ")}`);
    }
    if (/מגנט|magnet|магнит/.test(q) && pricing.magnets_only?.say) facts.push(pricing.magnets_only.say);
    if (/בלונ|balloon|шар/.test(q) && pricing.balloons_only?.say) facts.push(pricing.balloons_only.say);
    if (/חבילה|יחד|combo|пакет/.test(q) && pricing.combo_magnets_balloons?.say) facts.push(pricing.combo_magnets_balloons.say);
  }

  return facts.filter(Boolean).slice(0, limit);
};

const parseDateString = (dateStr) => {
  if (!dateStr) return null;
  const match = dateStr.match(/(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = match[3] ? Number(match[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return null;
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
};

const createCalendarEvent = async ({ dateStr, summary, description }) => {
  if (!CALENDAR_ID) throw new Error("missing CALENDAR_ID");
  const calendar = await getCalendarClient();
  const isoDate = parseDateString(dateStr);
  if (!isoDate) throw new Error("bad_date");
  const event = {
    summary: summary || "אירוע צוות ארגמן",
    description,
    start: { date: isoDate },
    end: { date: isoDate }
  };
  const res = await calendar.events.insert({
    calendarId: CALENDAR_ID,
    requestBody: event
  });
  return res.data?.id || null;
};

const createThread = async () => {
  const response = await fetch(`${OPENAI_API_BASE}/threads`, {
    method: "POST",
    headers: openAIHeaders,
    body: JSON.stringify({})
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`thread_create_failed:${response.status}:${text}`);
  }
  const data = await response.json();
  return data.id;
};

const postUserMessage = async (threadId, message) => {
  const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/messages`, {
    method: "POST",
    headers: openAIHeaders,
    body: JSON.stringify({
      role: "user",
      content: String(message || "").slice(0, 2000)
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`message_failed:${response.status}:${text}`);
  }
};

const runAssistant = async (threadId, assistantId) => {
  const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/runs`, {
    method: "POST",
    headers: openAIHeaders,
    body: JSON.stringify({ assistant_id: assistantId })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`run_create_failed:${response.status}:${text}`);
  }
  const data = await response.json();
  return data.id;
};

const pollRun = async (threadId, runId) => {
  const maxAttempts = 15;
  for (let i = 0; i < maxAttempts; i += 1) {
    const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/runs/${runId}`, {
      headers: openAIHeaders
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`run_status_failed:${response.status}:${text}`);
    }
    const data = await response.json();
    if (data.status === "completed") return;
    if (["failed", "cancelled", "expired"].includes(data.status)) {
      throw new Error(`run_${data.status}`);
    }
    await delay(400);
  }
  throw new Error("run_timeout");
};

const fetchLatestReply = async (threadId) => {
  const response = await fetch(`${OPENAI_API_BASE}/threads/${threadId}/messages?limit=5&order=desc`, {
    headers: openAIHeaders
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`messages_failed:${response.status}:${text}`);
  }
  const data = await response.json();
  const message = data.data?.find((m) => m.role === "assistant");
  const content = message?.content?.[0]?.text?.value;
  return content ? String(content).trim() : null;
};

app.post("/api/thread", async (req, res) => {
  try {
    await ensureAssistant();
    const threadId = await createThread();
    await logEvent({ type: "thread_created", threadId });
    await writeThreadLine(threadId, "thread created");
    res.json({ threadId });
  } catch (err) {
    console.error("Thread create error:", err);
    res.status(500).json({ error: "thread_error" });
  }
});

app.post("/api/chat", async (req, res) => {
  try {
    const { threadId, message } = req.body || {};
    if (!threadId || typeof threadId !== "string") {
      return res.status(400).json({ error: "threadId_required" });
    }
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message_required" });
    }

    const assistantId = await ensureAssistant();
    const kbFacts = searchKb(message, 3);
    const enriched = kbFacts.length ? `${message}\n\n[Контекст]: ${kbFacts.join(" • ")}` : message;
    await logEvent({ type: "user_message", threadId, content: message, kbFacts });
    await writeThreadLine(threadId, `user: ${message}`);
    if (kbFacts.length) {
      await writeThreadLine(threadId, `kb: ${kbFacts.join(" | ")}`);
    }
    await postUserMessage(threadId, enriched);
    const runId = await runAssistant(threadId, assistantId);
    await pollRun(threadId, runId);
    const reply = await fetchLatestReply(threadId);
    if (!reply) {
      return res.status(502).json({ error: "empty_reply" });
    }
    await logEvent({ type: "assistant_message", threadId, content: reply });
    await writeThreadLine(threadId, `assistant: ${reply}`);
    res.json({ reply });
  } catch (err) {
    console.error("Chat API error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/lead", async (req, res) => {
  try {
    const { contact, conversation = [], ...meta } = req.body || {};
    if (!contact || typeof contact !== "string" || contact.trim().length < 3) {
      return res.status(400).json({ error: "contact_required" });
    }

    const record = {
      contact: contact.trim(),
      lang: meta.lang || "ru",
      services: Array.isArray(meta.services) ? meta.services.slice(0, 8) : [],
      eventType: meta.eventType || null,
      date: meta.date || null,
      city: meta.city || null,
      wantsPrice: Boolean(meta.wantsPrice),
      conversation: toChatMessages(conversation),
      threadId: typeof meta.threadId === "string" ? meta.threadId : null,
      createdAt: new Date().toISOString()
    };

    try {
      await fs.promises.appendFile(LEADS_PATH, `${JSON.stringify(record)}\n`);
      await logEvent({ type: "lead", threadId: record.threadId, contact: record.contact, meta: record });
      await writeThreadLine(record.threadId, `lead: ${record.contact} meta: ${JSON.stringify(record)}`);
    } catch (err) {
      console.error("Lead write error:", err);
      return res.status(500).json({ error: "store_failed" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Lead API error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

app.post("/api/status", async (req, res) => {
  try {
    const { threadId, status } = req.body || {};
    if (!threadId || typeof threadId !== "string") {
      return res.status(400).json({ error: "threadId_required" });
    }
    if (!status || typeof status !== "string") {
      return res.status(400).json({ error: "status_required" });
    }
    await logEvent({ type: "status", threadId, status });
    await writeThreadLine(threadId, `status: ${status}`);
    res.json({ ok: true });
  } catch (err) {
    console.error("Status API error:", err);
    res.status(500).json({ error: "server_error" });
  }
});

app.get("/api/calendar/ping", async (req, res) => {
  try {
    const auth = await getCalendarAuth();
    const token = await auth.getAccessToken();
    const hasToken = Boolean(token?.token || token);
    let calendarOk = false;
    if (CALENDAR_ID) {
      try {
        const calendar = await getCalendarClient();
        await calendar.calendars.get({ calendarId: CALENDAR_ID });
        calendarOk = true;
      } catch (err) {
        calendarOk = false;
      }
    }
    res.json({ ok: true, hasToken, calendarId: CALENDAR_ID || null, calendarOk });
  } catch (err) {
    console.error("Calendar ping error:", err);
    res.status(500).json({ error: "calendar_error" });
  }
});

app.post("/api/calendar/event", async (req, res) => {
  try {
    const { threadId, date, summary, description } = req.body || {};
    if (!threadId || typeof threadId !== "string") {
      return res.status(400).json({ error: "threadId_required" });
    }
    if (!date || typeof date !== "string") {
      return res.status(400).json({ error: "date_required" });
    }
    const eventId = await createCalendarEvent({ dateStr: date, summary, description });
    await writeThreadLine(threadId, `calendar_event: ${eventId || "created"}`);
    await logEvent({ type: "calendar_event", threadId, date, summary, eventId });
    res.json({ ok: true, eventId });
  } catch (err) {
    console.error("Calendar event error:", err);
    res.status(500).json({ error: "calendar_error" });
  }
});

app.get("/api/logs", async (req, res) => {
  try {
    const { threadId, limit } = req.query || {};
    const safeLimit = Math.min(Number(limit) || 200, 1000);
    const entries = await readLogs({ threadId: threadId || null, limit: safeLimit });
    res.json({ entries });
  } catch (err) {
    console.error("Logs read error:", err);
    res.status(500).json({ error: "logs_error" });
  }
});

app.get("/api/thread-log", async (req, res) => {
  try {
    const { threadId } = req.query || {};
    if (!threadId || typeof threadId !== "string") {
      return res.status(400).json({ error: "threadId_required" });
    }
    const filePath = threadFilePath(threadId);
    const exists = await fs.promises
      .access(filePath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      return res.status(404).json({ error: "not_found" });
    }
    const content = await fs.promises.readFile(filePath, "utf8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(content);
  } catch (err) {
    console.error("Thread log read error:", err);
    res.status(500).json({ error: "thread_log_error" });
  }
});

app.get("/api/kb", (req, res) => {
  try {
    const { query, limit } = req.query || {};
    const facts = searchKb(query || "", Math.min(Number(limit) || 3, 10));
    res.json({ facts });
  } catch (err) {
    console.error("KB search error:", err);
    res.status(500).json({ error: "kb_error" });
  }
});

app.use((req, res) => res.sendFile(path.join(__dirname, "index.html")));

ensureFiles().then(() => {
  app.listen(PORT, () => {
    console.log(`Web chat bot listening on http://localhost:${PORT}`);
  });
});
