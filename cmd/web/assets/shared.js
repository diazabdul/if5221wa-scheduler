/* =====================================================================
   UTIL
   ===================================================================== */
const LS = {
  raw(key) {
    try { return localStorage.getItem(key) || ""; } catch { return ""; }
  },
  json(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
    } catch {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

// For the few places that must build HTML strings. Templates use x-text,
// which never interprets markup.
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Feather has no strikethrough / quote / ordered-list glyphs; these
// follow the same 24px, 2px-stroke style (paths from Lucide, ISC).
const CUSTOM_ICONS = {
  strike: '<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><line x1="4" y1="12" x2="20" y2="12"/>',
  quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  "list-ordered": '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><path d="M4 6h1v4"/><path d="M4 10h2"/><path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
};

function icon(name, size = 16, attrs = {}) {
  if (CUSTOM_ICONS[name]) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${CUSTOM_ICONS[name]}</svg>`;
  }
  const i = window.feather && feather.icons[name];
  return i ? i.toSvg({ width: size, height: size, "aria-hidden": "true", focusable: "false", ...attrs }) : "";
}

const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const initialOf = (s) => (String(s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").charAt(0) || "?").toUpperCase();

function utf8ToBase64(s) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
function usernameFromToken(token) {
  try {
    const bytes = Uint8Array.from(atob(token), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes).split(":")[0];
  } catch { return ""; }
}

/* =====================================================================
   TIME — always Asia/Jakarta (GMT+7, no DST), whatever the browser zone
   ===================================================================== */
const TZ_OFFSET = 7 * 3600;
const TZ_LABEL = "GMT+7 · Asia/Jakarta";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const nowTs = () => Math.floor(Date.now() / 1000);

// Wall-clock parts in Jakarta for a unix timestamp (seconds).
function jkt(ts) {
  const d = new Date((ts + TZ_OFFSET) * 1000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), wd: d.getUTCDay() };
}
const dayIndex = (ts) => Math.floor((ts + TZ_OFFSET) / 86400);

function fmtTime(ts) {
  const p = jkt(ts);
  return `${pad(p.h)}:${pad(p.mi)}`;
}
function fmtDate(ts, withYear = false) {
  const p = jkt(ts);
  const year = withYear || p.y !== jkt(nowTs()).y ? ` ${p.y}` : "";
  return `${DAYS[p.wd]}, ${p.d} ${MONTHS[p.m]}${year}`;
}
// "Today, 20:30" / "Tomorrow, 09:00" / "Sat, 3 Oct · 09:00"
function fmtWhen(ts) {
  const diff = dayIndex(ts) - dayIndex(nowTs());
  if (diff === 0) return `Today, ${fmtTime(ts)}`;
  if (diff === 1) return `Tomorrow, ${fmtTime(ts)}`;
  if (diff === -1) return `Yesterday, ${fmtTime(ts)}`;
  return `${fmtDate(ts)} · ${fmtTime(ts)}`;
}
// "Sat, 09:00" within a week, otherwise like fmtWhen
function fmtWhenCompact(ts) {
  const diff = dayIndex(ts) - dayIndex(nowTs());
  if (diff >= 2 && diff < 7) return `${DAYS[jkt(ts).wd]}, ${fmtTime(ts)}`;
  return fmtWhen(ts);
}
const fmtFull = (ts) => `${fmtDate(ts, true)} · ${fmtTime(ts)} (GMT+7)`;
function fmtUtc(ts) {
  const d = new Date(ts * 1000);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function fmtRelative(ts, now = nowTs()) {
  const s = ts - now;
  const a = Math.abs(s);
  if (a < 60) return s >= 0 ? "in a moment" : "just now";
  if (a < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(dayIndex(ts) - dayIndex(now), "day");
}
function fmtShortIn(ts, now = nowTs()) {
  const s = ts - now;
  if (s <= 60) return "now";
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} d`;
}
// "YYYY-MM-DD HH:MM" typed/picked as Jakarta wall time -> unix seconds
function parseJakartaInput(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(String(str || "").trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000 - TZ_OFFSET;
}
function toJakartaInput(ts) {
  const p = jkt(ts);
  return `${p.y}-${pad(p.m + 1)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

// flatpickr only ever sees Jakarta wall-clock strings, so the browser
// zone never leaks into the timestamp.
function initDatePicker(el, onChange) {
  return flatpickr(el, {
    enableTime: true,
    time_24hr: true,
    minuteIncrement: 1,
    dateFormat: "Y-m-d H:i",
    static: true,
    disableMobile: true,
    minDate: jktTodayLocal(),
    onOpen(_, __, fp) {
      fp.set("minDate", jktTodayLocal());
      if (!fp.input.value) fp.setDate(toJakartaInput(nowTs() + 5 * 60), true);
    },
    onChange(_, dateStr) { onChange(dateStr); },
    onClose: notePickerClosed,
  });
}

/* =====================================================================
   RECIPIENTS
   ===================================================================== */
const isGroup = (jid) => String(jid || "").endsWith("@g.us");
// Small breakpoint matches tailwind.config screens (md starts at 641px).
const isSmall = () => window.matchMedia("(max-width: 640px)").matches;


// "+62 812-3456 7890" / "0812..." / "62812..." -> "62812...@s.whatsapp.net"
function normalizeRecipient(raw) {
  const s = String(raw || "").trim();
  if (!s) return { ok: false, error: "Enter a phone number or group ID." };
  if (s.includes("@")) {
    if (/^\d{5,}@s\.whatsapp\.net$/.test(s) || /^[\d-]{5,}@g\.us$/.test(s)) return { ok: true, jid: s };
    return { ok: false, error: `"${s}" is not a valid WhatsApp ID. Use a number like +62 812 3456 7890 or a group ID ending in @g.us.` };
  }
  let d = s.replace(/[\s\-().]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  if (!/^\d+$/.test(d)) return { ok: false, error: `"${s}" contains letters or symbols. Use digits only, e.g. +62 812 3456 7890.` };
  if (d.startsWith("0")) d = "62" + d.slice(1);
  if (d.length < 8 || d.length > 15) {
    return { ok: false, error: `"${s}" has ${d.length} digits. Phone numbers need 8–15 digits including the country code.` };
  }
  return { ok: true, jid: `${d}@s.whatsapp.net` };
}

function formatPhone(digits) {
  if (digits.startsWith("62")) {
    const r = digits.slice(2);
    return "+62 " + [r.slice(0, 3), r.slice(3, 7), r.slice(7)].filter(Boolean).join(" ");
  }
  return "+" + digits;
}

/* =====================================================================
   FAILURE REASONS — map raw scheduler text to short labels when known
   ===================================================================== */
const FAILURE_RULES = [
  [/session expired|ERR_SESSION_EXPIRED/i, "Session expired"],
  [/connection refused|no such host|timeout|unreachable|dial tcp|EOF/i, "Publisher unreachable"],
  [/not (on whatsapp|registered|exist)|invalid (jid|number)/i, "Number not on WhatsApp"],
  [/unauthori[sz]ed|forbidden|\b401\b/i, "Publisher rejected credentials"],
];
function failureLabel(reason) {
  if (!reason) return "Failed";
  const r = String(reason).trim();
  const m = /^failed to send message after \d+ retries:\s*([\s\S]*)$/i.exec(r);
  const inner = m ? m[1] : r;
  for (const [re, label] of FAILURE_RULES) if (re.test(inner)) return label;
  return capitalize(inner || r);
}
const retriedLabel = (n) => (n > 0 ? `retried ${n} ${n === 1 ? "time" : "times"}` : "");

/* =====================================================================
   WHATSAPP MARKUP — preview renderer (escape first, then add our tags)
   ===================================================================== */
const WA_OPEN = "(^|[\\s>(\\[{.,!?;:\"'-])";
const WA_CLOSE = "(?=$|[\\s<)\\]}.,!?;:\"'&-])";
const WA_INLINE = [
  [new RegExp(WA_OPEN + "\\*(\\S(?:[^*\\n]*?\\S)?)\\*" + WA_CLOSE, "g"), "$1<strong>$2</strong>"],
  [new RegExp(WA_OPEN + "_(\\S(?:[^_\\n]*?\\S)?)_" + WA_CLOSE, "g"), "$1<em>$2</em>"],
  [new RegExp(WA_OPEN + "~(\\S(?:[^~\\n]*?\\S)?)~" + WA_CLOSE, "g"), "$1<s>$2</s>"],
];

function renderWhatsAppInline(s) {
  const kept = [];
  const keep = (html) => `\u0000${kept.push(html) - 1}\u0000`;
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code class="wa-code">${c}</code>`));
  s = s.replace(/https?:\/\/[^\s<]+/g, (url) => keep(`<span class="wa-link">${url}</span>`));
  for (const [re, html] of WA_INLINE) s = s.replace(re, html);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[i]);
}

function renderWhatsAppLines(s) {
  return s
    .split("\n")
    .map((line) => {
      let m;
      if ((m = /^&gt; ?(.*)$/.exec(line))) return `<div class="wa-quote">${renderWhatsAppInline(m[1]) || "<br>"}</div>`;
      if ((m = /^[-*] (.*)$/.exec(line))) return `<div class="wa-li"><span>•</span><span>${renderWhatsAppInline(m[1])}</span></div>`;
      if ((m = /^(\d+)\. (.*)$/.exec(line))) return `<div class="wa-li"><span>${m[1]}.</span><span>${renderWhatsAppInline(m[2])}</span></div>`;
      return `<div>${renderWhatsAppInline(line) || "<br>"}</div>`;
    })
    .join("");
}

// Markup-free text for one-line list cells.
function plainWhatsApp(text) {
  let t = String(text ?? "").replace(/```([\s\S]*?)```/g, "$1").replace(/`([^`\n]+)`/g, "$1");
  for (const [re] of WA_INLINE) t = t.replace(re, "$1$2");
  return t.replace(/^> ?/gm, "").replace(/^[-*] /gm, "• ");
}

function renderWhatsApp(text) {
  const safe = escapeHtml(String(text ?? "").replace(/\u0000/g, ""));
  return safe
    .split(/```([\s\S]*?)```/)
    .map((part, i) =>
      i % 2 ? `<code class="wa-mono">${part.replace(/^\n|\n$/g, "")}</code>` : part && renderWhatsAppLines(part.replace(/^\n|\n$/g, ""))
    )
    .join("");
}

/* =====================================================================
   CONTACTS & DRAFT STORAGE (localStorage, this browser only)
   ===================================================================== */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const saveContacts = (list) => LS.set("wa_contacts", list);
const saveTemplates = (list) => LS.set("wa_templates", list);

// Quick picks, computed in Jakarta time.
function presetTs(key, now = nowTs()) {
  if (key === "hour") return Math.ceil((now + 3600) / 60) * 60;
  const p = jkt(now);
  const today9 = Date.UTC(p.y, p.m, p.d, 9, 0) / 1000 - TZ_OFFSET;
  if (key === "tomorrow") return today9 + 86400;
  if (key === "monday") return today9 + ((8 - p.wd) % 7 || 7) * 86400;
  return NaN;
}
// flatpickr builds local Date objects from wall-clock values; this keeps
// "today" anchored to Jakarta.
function jktTodayLocal() {
  const p = jkt(nowTs());
  return new Date(p.y, p.m, p.d);
}

/* =====================================================================
   API — contract unchanged (docs/rest_api.md)
   ===================================================================== */
class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const api = {
  token: "",
  async request(method, path, body, token) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          Authorization: `Basic ${token ?? this.token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
    }
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || !data || data.ok === false) {
      throw new ApiError(capitalize(data?.msg) || `Request failed (HTTP ${res.status}).`, res.status, data?.err);
    }
    return data;
  },
  check(token) { return this.request("GET", "/check", null, token); },
  messages(status) {
    return this.request("GET", status ? `/messages?status=${encodeURIComponent(status)}` : "/messages");
  },
  schedule(payload) { return this.request("POST", "/messages", payload); },
  retry(id, scheduledSendingAt) {
    return this.request("POST", `/messages/${encodeURIComponent(id)}/retry`, { scheduled_sending_at: scheduledSendingAt });
  },
};
