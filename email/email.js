/**
 * kit/email – שליחת מיילים מהדפדפן. מודול עצמאי, בלי תלויות.
 *
 * שתי דרכי שליחה:
 *  1. openGmailDraft(msg) / mailtoUrl(msg) – פותח טיוטה מוכנה; המשתמש לוחץ "שלח". בלי הגדרות. בלי קבצים מצורפים.
 *  2. new GmailSender({ clientId }).send(msg) – שליחה אוטומטית דרך Gmail API, אחרי "התחברות עם Google".
 *     דורש פעם אחת: פרויקט ב-Google Cloud + OAuth Client ID (ראו README.md). תומך בקבצים מצורפים.
 *
 * מבנה הודעה (msg):
 *   { to: string|string[], cc?, bcc?, subject: string, text?: string, html?: string, replyTo?: string,
 *     attachments?: [{ filename: string, mimeType: string, data: Uint8Array | string(base64) }] }
 */

// ---------------------------------------------------------------- כתובות
const EMAIL_RE = /^[^\s@"<>(),;:]+@[^\s@"<>(),;:]+\.[^\s@"<>(),;:]{2,}$/;

export function isValidEmail(addr) {
  return typeof addr === 'string' && EMAIL_RE.test(addr.trim());
}

/** מקבל מחרוזת ("a@x.com, b@y.com") או מערך; מחזיר מערך כתובות נקי. זורק שגיאה על כתובת לא תקינה. */
export function parseAddresses(value) {
  if (value == null || value === '') return [];
  const list = (Array.isArray(value) ? value : String(value).split(/[,;\n]/)).map((s) => String(s).trim()).filter(Boolean);
  const bad = list.filter((a) => !isValidEmail(a));
  if (bad.length) throw new Error(`כתובת מייל לא תקינה: ${bad.join(', ')}`);
  return list;
}

/** בדיקת הודעה לפני שליחה. מחזיר הודעה מנורמלת. */
export function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'object') throw new Error('חסרה הודעה');
  const to = parseAddresses(msg.to);
  if (!to.length) throw new Error('חסר נמען (to)');
  if (!msg.subject?.trim()) throw new Error('חסר נושא (subject)');
  if (!msg.text && !msg.html) throw new Error('חסר תוכן (text או html)');
  return {
    to, cc: parseAddresses(msg.cc), bcc: parseAddresses(msg.bcc),
    replyTo: msg.replyTo ? parseAddresses(msg.replyTo)[0] : undefined,
    subject: msg.subject.trim(), text: msg.text ?? '', html: msg.html ?? '',
    attachments: (msg.attachments ?? []).map((a, i) => {
      if (!a?.filename || !a?.mimeType || a.data == null) throw new Error(`קובץ מצורף ${i + 1}: חסר filename / mimeType / data`);
      return a;
    }),
  };
}

// ---------------------------------------------------------------- קידוד
const utf8 = (s) => new TextEncoder().encode(s);

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const toBase64 = (data) => (typeof data === 'string' ? data.replace(/\s+/g, '') : bytesToBase64(data));
const wrap76 = (b64) => b64.replace(/.{1,76}/g, '$&\r\n').trimEnd();
const base64url = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** כותרת עם עברית: RFC 2047 (=?UTF-8?B?...?=). */
export function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${bytesToBase64(utf8(value))}?=`;
}

const boundary = () => `kit_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

function textPart(type, content) {
  return `Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(bytesToBase64(utf8(content)))}`;
}

/** בונה הודעת MIME מלאה (RFC 5322) – עברית, HTML וקבצים מצורפים. */
export function buildMime(input, { from } = {}) {
  const m = normalizeMessage(input);
  const headers = [
    from ? `From: ${from}` : null,
    `To: ${m.to.join(', ')}`,
    m.cc.length ? `Cc: ${m.cc.join(', ')}` : null,
    m.bcc.length ? `Bcc: ${m.bcc.join(', ')}` : null,
    m.replyTo ? `Reply-To: ${m.replyTo}` : null,
    `Subject: ${encodeHeader(m.subject)}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);

  // גוף: text ו/או html
  let body;
  if (m.text && m.html) {
    const b = boundary();
    body = { type: `multipart/alternative; boundary="${b}"`,
      content: `--${b}\r\n${textPart('text/plain', m.text)}\r\n--${b}\r\n${textPart('text/html', m.html)}\r\n--${b}--` };
  } else {
    const [type, content] = m.html ? ['text/html', m.html] : ['text/plain', m.text];
    const part = textPart(type, content).split('\r\n\r\n');
    body = { type: `${type}; charset=UTF-8`, content: part.slice(1).join('\r\n\r\n'), cte: 'base64' };
  }

  if (!m.attachments.length) {
    return [...headers, `Content-Type: ${body.type}`, ...(body.cte ? [`Content-Transfer-Encoding: ${body.cte}`] : []), '', body.content].join('\r\n');
  }
  const b = boundary();
  const parts = [
    `--${b}\r\nContent-Type: ${body.type}\r\n${body.cte ? `Content-Transfer-Encoding: ${body.cte}\r\n` : ''}\r\n${body.content}`,
    ...m.attachments.map((a) => {
      const name = encodeHeader(a.filename);
      return `--${b}\r\nContent-Type: ${a.mimeType}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\n`
        + `Content-Transfer-Encoding: base64\r\n\r\n${wrap76(toBase64(a.data))}`;
    }),
  ];
  return [...headers, `Content-Type: multipart/mixed; boundary="${b}"`, '', `${parts.join('\r\n')}\r\n--${b}--`].join('\r\n');
}

// ---------------------------------------------------------------- 1. טיוטה (בלי הגדרות)
/** קישור לטיוטה ב-Gmail (נפתח בדפדפן). אין תמיכה בקבצים מצורפים. */
export function gmailComposeUrl(input) {
  const m = normalizeMessage({ ...input, attachments: [] });
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: m.to.join(','), su: m.subject, body: m.text || htmlToText(m.html) });
  if (m.cc.length) p.set('cc', m.cc.join(','));
  if (m.bcc.length) p.set('bcc', m.bcc.join(','));
  return `https://mail.google.com/mail/?${p.toString()}`;
}

/** קישור mailto: – נפתח בתוכנת הדואר המוגדרת במחשב. */
export function mailtoUrl(input) {
  const m = normalizeMessage({ ...input, attachments: [] });
  const q = [`subject=${encodeURIComponent(m.subject)}`, `body=${encodeURIComponent(m.text || htmlToText(m.html))}`];
  if (m.cc.length) q.push(`cc=${encodeURIComponent(m.cc.join(','))}`);
  if (m.bcc.length) q.push(`bcc=${encodeURIComponent(m.bcc.join(','))}`);
  return `mailto:${m.to.map(encodeURIComponent).join(',')}?${q.join('&')}`;
}

export function htmlToText(html) {
  return String(html ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}

/** פותח טיוטה ב-Gmail בלשונית חדשה. יש לקרוא מתוך לחיצה של המשתמש (אחרת הדפדפן חוסם). */
export function openGmailDraft(msg) {
  const w = window.open(gmailComposeUrl(msg), '_blank', 'noopener');
  if (!w) throw new Error('הדפדפן חסם את פתיחת החלון – אפשר חלונות קופצים לאתר');
}

// ---------------------------------------------------------------- 2. Gmail API (אוטומטי)
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('טעינת ההתחברות של Google נכשלה'));
    document.head.appendChild(s);
  });
}

/**
 * שליחה אוטומטית מחשבון Gmail של המשתמש. ההרשאה היחידה: gmail.send (שליחה בלבד – בלי קריאת מיילים).
 * ה-token נשמר בזיכרון בלבד (לא ב-localStorage) ותקף כשעה; אחר כך connect() שוב.
 */
export class GmailSender {
  #clientId; #token = null; #expires = 0;
  constructor({ clientId }) {
    if (!clientId || !/\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('חסר Google OAuth Client ID תקין (ראו README)');
    this.#clientId = clientId;
  }
  get connected() { return !!this.#token && Date.now() < this.#expires; }

  /** פותח את חלון "התחברות עם Google". יש לקרוא מתוך לחיצה של המשתמש. */
  async connect() {
    await loadGis();
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.#clientId, scope: SCOPE,
        callback: (r) => {
          if (r.error) return reject(new Error(`ההתחברות נכשלה: ${r.error}`));
          this.#token = r.access_token; this.#expires = Date.now() + (Number(r.expires_in) - 60) * 1000; resolve(true);
        },
        error_callback: (e) => reject(new Error(`ההתחברות בוטלה: ${e?.type ?? 'unknown'}`)),
      });
      client.requestAccessToken();
    });
  }

  disconnect() {
    if (this.#token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(this.#token, () => {});
    this.#token = null; this.#expires = 0;
  }

  /** שולח הודעה. מחזיר { id, threadId } של Gmail. */
  async send(msg) {
    if (!this.connected) throw new Error('לא מחובר ל-Gmail – יש ללחוץ "התחבר" קודם');
    const raw = base64url(bytesToBase64(utf8(buildMime(msg))));
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${this.#token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Gmail החזיר שגיאה ${res.status}: ${data?.error?.message ?? ''}`);
    return { id: data.id, threadId: data.threadId };
  }
}

// ---------------------------------------------------------------- תבניות
/** ממלא {{שם}} בערכים. שדה חסר → שגיאה (כדי לא לשלוח "{{name}}" ללקוח). */
export function fillTemplate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([\w֐-׿.]+)\s*\}\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    if (v == null) throw new Error(`חסר ערך לשדה {{${key}}} בתבנית`);
    return String(v);
  });
}
