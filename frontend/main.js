const chat = document.querySelector(".chat");
const chatToggle = document.querySelector(".chat-toggle");
const chatClose = document.querySelector(".chat__close");
const chatBody = document.getElementById("chat-body");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-text");
const contactButton = document.getElementById("contact-button");
const contactForm = document.getElementById("contact-form");
const contactInput = document.getElementById("contact-input");
const waLink = document.getElementById("wa-link");
const callLink = document.getElementById("call-link");
const statusPill = document.getElementById("status-pill");
const statusMenu = document.getElementById("status-menu");
const statusLabel = document.getElementById("status-label");
const statusDot = document.getElementById("status-dot");

const rawApiBase = typeof window !== "undefined" ? String(window.API_BASE || "") : "";
const fallbackApiBase =
  typeof window !== "undefined" && window.location?.protocol === "file:"
    ? "http://localhost:3000"
    : "";
const API_BASE = (rawApiBase || fallbackApiBase).replace(/\/$/, "");
const apiUrl = (path) => (API_BASE ? `${API_BASE}${path}` : path);
const FORCE_NEW_THREAD = true;
const WA_NUMBER = "972000000000";
const CALL_NUMBER = "+972000000000";
const conversation = [];
let threadId = null;

const services = [
  { id: "magnets", keywords: ["магнит", "магниты", "magnit", "מגנט", "מגנטים"], labels: { ru: "магниты", he: "מגנטים" } },
  { id: "balloons", keywords: ["шар", "шары", "шарики", "balloon", "בלון", "בלונים"], labels: { ru: "шары", he: "בלונים" } },
  { id: "photobooth", keywords: ["фотобуд", "фото буд", "будка", "photobooth", "פוטובות", "פוטו בות"], labels: { ru: "фотобудка", he: "פוטובות" } },
  { id: "shooting", keywords: ["съемк", "сним", "фото", "видео", "съёмк", "צילום"], labels: { ru: "съёмка", he: "צילום" } }
];

const eventTypes = [
  { keywords: ["свад", "свадз", "wedding", "חתונ"], labels: { ru: "свадьба", he: "חתונה" } },
  { keywords: ["бар", "бат", "מצו", "бар-миц", "бат-миц"], labels: { ru: "бар/бат-мицва", he: "בר/בת מצווה" } },
  { keywords: ["корп", "ивент", "event", "אירוע חברה"], labels: { ru: "корпоратив", he: "אירוע חברה" } },
  { keywords: ["др", "день рож", "birthday", "יומול"], labels: { ru: "день рождения", he: "יום הולדת" } }
];

const cities = [
  { keywords: ["тель", "tel aviv", "תל", "ת\"א"], label: "Тель-Авив" },
  { keywords: ["хаиф", "haifa", "חיפ"], label: "Хайфа" },
  { keywords: ["иерус", "jerusalem", "ירוש"], label: "Иерусалим" },
  { keywords: ["ашдод", "אשדוד"], label: "Ашдод" },
  { keywords: ["ашкел", "אשקל"], label: "Ашкелон" },
  { keywords: ["нетан", "נתני"], label: "Нетания" },
  { keywords: ["риша", "ришон", "ראשון"], label: "Ришон-ле-Цион" },
  { keywords: ["бат ям", "בת ים"], label: "Бат-Ям" }
];

const texts = {
  ru: {
    greet: "Привет! Помогу по услугам: магниты, шары, фотобудка, съёмка. Скажите тип события, дату и город.",
    escalate: "Чтобы не ошибиться, передам менеджеру. Оставьте, пожалуйста, контакт.",
    contactThanks: "Спасибо, передаю менеджеру. Если нужно быстрее — нажмите WhatsApp.",
    contactPlaceholder: "+972...",
    inputPlaceholder: "Напишите сообщение...",
    contactLabel: "Телефон или WhatsApp",
    contactFail: "Не смог передать контакт, нажмите WhatsApp или попробуйте позже.",
    error: "Не получилось получить ответ. Нажмите WhatsApp или оставьте контакт.",
    actions: { contact: "Оставить контакт", call: "Позвонить", whatsapp: "WhatsApp" }
  },
  he: {
    greet: "היי! אני כאן לעזור עם מגנטים, בלונים, פוטובות או צילום. רשום סוג אירוע, תאריך ועיר.",
    escalate: "כדי לא לטעות, מעביר למנהל. השאר בבקשה טלפון.",
    contactThanks: "תודה, מעביר למנהל. אם צריך מהר — לחץ WhatsApp.",
    contactPlaceholder: "+972...",
    inputPlaceholder: "כתוב הודעה...",
    contactLabel: "טלפון או WhatsApp",
    contactFail: "לא הצלחתי להעביר כרגע, לחץ WhatsApp או נסה שוב.",
    error: "לא הצלחתי לקבל תשובה כרגע. לחץ WhatsApp או השאר קשר.",
    actions: { contact: "השאר קשר", call: "שיחה", whatsapp: "WhatsApp" }
  }
};

const state = {
  lang: "ru",
  services: [],
  eventType: null,
  date: null,
  city: null,
  wantsPrice: false
};

const priceKeywords = ["цена", "стоим", "сколько", "прайс", "מחיר", "כמה", "עלות"];
const outOfScopeKeywords = ["кейтер", "кейтеринг", "ведущ", "dj", "диджей", "аниматор", "аренда зала", "сцена", "свет", "звук", "decor", "декор"];
const dateRegex = /\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?/;

const statusConfig = {
  new: { label: "NEW", color: "#8ec5ff" },
  qualified: { label: "QUALIFIED", color: "#7ee0d2" },
  offer_sent: { label: "OFFER_SENT", color: "#ffd166" },
  need_human: { label: "NEED_HUMAN", color: "#ffb347" },
  support: { label: "SUPPORT", color: "#94a9ff" },
  won: { label: "WON", color: "#7ee07e" },
  lost: { label: "LOST", color: "#ff7a8a" }
};

let currentStatus =
  (FORCE_NEW_THREAD ? null : localStorage.getItem("ag_status")) || "new";
const statusPriority = { new: 1, qualified: 2, offer_sent: 3, support: 3, need_human: 4, won: 5, lost: 5 };
let calendarEventSent = false;
let hasWonStatus = false;

const autoScroll = () => {
  chatBody.scrollTop = chatBody.scrollHeight;
};

const detectLanguage = (text) => (/[א-ת]/.test(text) ? "he" : "ru");

const appendMessage = (text, from = "bot") => {
  const bubble = document.createElement("div");
  bubble.className = `bubble bubble--${from === "user" ? "user" : "bot"}`;
  bubble.textContent = text;
  chatBody.appendChild(bubble);
  autoScroll();
};

const addUserMessage = (text) => {
  appendMessage(text, "user");
  conversation.push({ role: "user", content: text });
};

const addBotMessage = (text, push = true) => {
  appendMessage(text, "bot");
  if (push) {
    conversation.push({ role: "assistant", content: text });
  }
  const nextStatus = evaluateStatus(text);
  setStatus(nextStatus);
};

const formatServices = (lang) => {
  const labels = services
    .filter((srv) => state.services.includes(srv.id))
    .map((srv) => srv.labels[lang] || srv.labels.ru);
  return labels.length ? labels.join(", ") : null;
};

const addInitialMessage = () => {
  addBotMessage(texts[state.lang].greet);
  chatInput.placeholder = texts[state.lang].inputPlaceholder;
  contactInput.placeholder = texts[state.lang].contactPlaceholder;
};

const toggleChat = (open) => {
  const willOpen = typeof open === "boolean" ? open : !chat.classList.contains("chat--open");
  chat.classList.toggle("chat--open", willOpen);
  if (willOpen) {
    chatToggle.querySelector(".chat-toggle__badge").style.display = "none";
    chatInput.focus();
  }
};

const updateActionsLabels = () => {
  const copy = texts[state.lang].actions;
  contactButton.textContent = copy.contact;
  callLink.textContent = copy.call;
  waLink.textContent = copy.whatsapp;
  contactForm.querySelector("label").textContent = texts[state.lang].contactLabel;
  chatInput.placeholder = texts[state.lang].inputPlaceholder;
  contactInput.placeholder = texts[state.lang].contactPlaceholder;
};

const updateLinks = () => {
  const summaryParts = [];
  if (state.services.length) summaryParts.push(formatServices(state.lang));
  if (state.date) summaryParts.push(state.date);
  if (state.city) summaryParts.push(state.city);
  if (state.eventType) summaryParts.push(state.eventType);
  const prefix = state.lang === "he" ? "בקשה" : "Запрос";
  const prefill = encodeURIComponent(`${prefix}: ${summaryParts.filter(Boolean).join(" · ") || "чат"} `);
  waLink.href = `https://wa.me/${WA_NUMBER}?text=${prefill}`;
  callLink.href = `tel:${CALL_NUMBER}`;
};

const extractService = (text) => {
  services.forEach((srv) => {
    if (srv.keywords.some((k) => text.includes(k))) {
      if (!state.services.includes(srv.id)) state.services.push(srv.id);
    }
  });
};

const extractEventType = (text) => {
  eventTypes.forEach((ev) => {
    if (ev.keywords.some((k) => text.includes(k))) state.eventType = ev.labels[state.lang] || ev.labels.ru;
  });
};

const extractCity = (text) => {
  cities.forEach((city) => {
    if (city.keywords.some((k) => text.includes(k))) state.city = city.label;
  });
};

const extractDate = (text) => {
  const match = text.match(dateRegex);
  if (match) state.date = match[0];
};

const wantsPrice = (text) => priceKeywords.some((kw) => text.includes(kw));
const needsManager = (text) => outOfScopeKeywords.some((kw) => text.includes(kw));
const isWon = (text) => /סגור|יאללה|קובעים|готов|беру|подходит|закрываем/i.test(text);
const isLost = (text) => /מצאתי|לא רלוונטי|не актуально|отмена|не нужен|дорого/i.test(text);
const isHandoff = (text) => /תן לי רגע לבדוק|אבדוק ואחזור|передам|вернусь с ответом/i.test(text);

const evaluateStatus = (text) => {
  const lowered = text.toLowerCase();
  if (isLost(text)) return "lost";
  if (isWon(text)) return "won";
  if (isHandoff(text) || needsManager(lowered)) return "need_human";
  if (state.services.length && state.date && state.city && state.wantsPrice) return "offer_sent";
  if (state.services.length && state.date && state.city) return "qualified";
  return currentStatus;
};

const renderStatus = () => {
  const cfg = statusConfig[currentStatus] || statusConfig.new;
  statusLabel.textContent = cfg.label;
  statusDot.style.background = cfg.color;
  localStorage.setItem("ag_status", currentStatus);
};

const setStatus = (status) => {
  if (!statusConfig[status]) return;
  currentStatus = status;
  if (status === "won") hasWonStatus = true;
  if (status === "lost") hasWonStatus = false;
  renderStatus();
  sendStatus(status).catch(() => {});
  maybeSendCalendarEvent();
};

const sendStatus = async (status) => {
  const currentThread = await ensureThread();
  await fetch(apiUrl("/api/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId: currentThread, status })
  });
};

const sendCalendarEvent = async () => {
  const currentThread = await ensureThread();
  const summary = `אירוע · ${state.city || "ללא עיר"} · ${formatServices(state.lang) || "שירותים לא ידועים"}`;
  const description = [
    `thread: ${currentThread}`,
    state.services.length ? `services: ${formatServices("he") || state.services.join(",")}` : "",
    state.eventType ? `event: ${state.eventType}` : "",
    state.city ? `city: ${state.city}` : "",
    state.date ? `date: ${state.date}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(apiUrl("/api/calendar/event"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: currentThread,
      date: state.date,
      summary,
      description
    })
  });
  return res.ok;
};

function maybeSendCalendarEvent() {
  const canSend = (currentStatus === "won" || hasWonStatus) && currentStatus !== "lost";
  if (canSend && state.date && !calendarEventSent) {
    sendCalendarEvent()
      .then((ok) => {
        if (ok) calendarEventSent = true;
      })
      .catch(() => {});
  }
}

const toggleStatusMenu = () => {
  const isOpen = statusMenu.classList.contains("open");
  statusMenu.classList.toggle("open", !isOpen);
  statusPill.setAttribute("aria-expanded", String(!isOpen));
};

const ensureThread = async () => {
  if (threadId) return threadId;
  if (!FORCE_NEW_THREAD) {
    const stored = localStorage.getItem("ag_thread_id");
    if (stored) {
      threadId = stored;
      return threadId;
    }
  }
  localStorage.removeItem("ag_thread_id");
  localStorage.removeItem("ag_status");
  currentStatus = "new";
  const response = await fetch(apiUrl("/api/thread"), { method: "POST" });
  if (!response.ok) {
    throw new Error("thread_error");
  }
  const data = await response.json();
  if (!data.threadId) {
    throw new Error("thread_missing");
  }
  threadId = data.threadId;
  localStorage.setItem("ag_thread_id", threadId);
  return threadId;
};

const sendLead = async (contactValue) => {
  const currentThread = await ensureThread();
  const payload = {
    contact: contactValue,
    lang: state.lang,
    services: state.services,
    eventType: state.eventType,
    date: state.date,
    city: state.city,
    wantsPrice: state.wantsPrice,
    conversation: conversation.slice(-12),
    threadId: currentThread
  };

  const response = await fetch(apiUrl("/api/lead"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("lead_error");
  }
};

const callAssistant = async (message) => {
  const currentThread = await ensureThread();
  const payload = { threadId: currentThread, message };
  const response = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("chat_api_error");
  }

  const data = await response.json();
  if (!data.reply) {
    throw new Error("empty_reply");
  }

  return data.reply;
};

const processMessage = async (value) => {
  const text = value.trim();
  if (!text) return;

  addUserMessage(text);

  const lowered = text.toLowerCase();
  state.lang = detectLanguage(text) || state.lang;
  extractService(lowered);
  extractEventType(lowered);
  extractCity(lowered);
  extractDate(text);
  maybeSendCalendarEvent();
  if (wantsPrice(lowered)) state.wantsPrice = true;

  updateActionsLabels();
  updateLinks();

  setStatus(evaluateStatus(text));

  if (needsManager(lowered)) {
    setTimeout(() => addBotMessage(texts[state.lang].escalate), 150);
    return;
  }

  try {
    const reply = await callAssistant(text);
    setTimeout(() => addBotMessage(reply), 150);
  } catch (err) {
    console.error(err);
    setTimeout(() => addBotMessage(texts[state.lang].error, false), 150);
  }
};

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = chatInput.value;
  chatInput.value = "";
  processMessage(value);
});

statusPill.addEventListener("click", toggleStatusMenu);
statusMenu.addEventListener("click", (e) => {
  if (e.target.dataset.status) {
    setStatus(e.target.dataset.status);
    toggleStatusMenu();
  }
});

document.addEventListener("click", (e) => {
  if (!statusMenu.contains(e.target) && !statusPill.contains(e.target)) {
    statusMenu.classList.remove("open");
    statusPill.setAttribute("aria-expanded", "false");
  }
});

contactButton.addEventListener("click", () => {
  contactForm.classList.toggle("contact-form--open");
  if (contactForm.classList.contains("contact-form--open")) {
    contactInput.focus();
  }
});

contactForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const value = contactInput.value.trim();
  if (!value) return;
  addUserMessage(`${texts[state.lang].contactLabel}: ${value}`);
  contactInput.value = "";
  contactForm.classList.remove("contact-form--open");
  sendLead(value)
    .then(() => setTimeout(() => addBotMessage(texts[state.lang].contactThanks), 150))
    .catch(() => setTimeout(() => addBotMessage(texts[state.lang].contactFail, false), 150));
});

chatToggle.addEventListener("click", () => toggleChat());
chatClose.addEventListener("click", () => toggleChat(false));

document.addEventListener("DOMContentLoaded", () => {
  ensureThread().catch((err) => console.error("Thread init failed", err));
  addInitialMessage();
  updateActionsLabels();
  updateLinks();
  renderStatus();
});
