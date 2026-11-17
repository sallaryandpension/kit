/**
 * kit/whatsapp – הכנת הודעות וואטסאפ מהדפדפן. מודול עצמאי, בלי תלויות.
 *
 * פותח את וואטסאפ (אפליקציה או WhatsApp Web) על השיחה הנכונה, עם הטקסט כבר כתוב. המשתמש לוחץ "שלח".
 * זו הדרך הרשמית של WhatsApp ("Click to Chat"): בלי חשבון, בלי עלות, בלי סיכון לחסימת המספר.
 *
 *   openWhatsApp({ phone: '050-1234567', text: 'שלום' })
 *   whatsappLink({ phone, text })            → https://wa.me/972501234567?text=...
 *   whatsappLink({ text })                   → בלי טלפון: וואטסאפ שואל למי לשלוח
 */

/**
 * נרמול מספר טלפון לפורמט בינלאומי בספרות בלבד (972501234567).
 *  '050-123-4567' → '972501234567' · '+972 50 123 4567' → '972501234567' · '00972501234567' → '972501234567'
 *  מספר זר עם + נשמר כמו שהוא ('+1 212 555 0100' → '12125550100').
 */
export function normalizePhone(input, { defaultCountry = '972' } = {}) {
  if (input == null) throw new Error('חסר מספר טלפון');
  const raw = String(input).trim();
  let digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = defaultCountry + digits.slice(1);
  else if (!digits.startsWith(defaultCountry) && digits.length <= 10) digits = defaultCountry + digits;
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('9720')) digits = '972' + digits.slice(4);          // "+972 050..." – אפס מיותר
  if (digits.length < 8 || digits.length > 15) throw new Error(`מספר טלפון לא תקין: ${raw}`);
  if (digits.startsWith('972') && !/^972(5\d{8}|[2-489]\d{7}|7\d{8})$/.test(digits))
    throw new Error(`מספר ישראלי לא תקין: ${raw}`);
  return digits;
}

export function isMobileIL(phone) {
  try { return /^9725\d{8}$/.test(normalizePhone(phone)); } catch { return false; }
}

/** קישור wa.me – עובד בטלפון ובמחשב (פותח את האפליקציה או WhatsApp Web). */
export function whatsappLink({ phone, text = '' } = {}) {
  const t = String(text ?? '');
  if (t.length > 4000) throw new Error('ההודעה ארוכה מדי (עד 4,000 תווים)');
  const q = t ? `?text=${encodeURIComponent(t)}` : '';
  return phone ? `https://wa.me/${normalizePhone(phone)}${q}` : `https://wa.me/${q}`;
}

/** קישור ישיר ל-WhatsApp Web (מחשב, בלי מסך ביניים). */
export function whatsappWebLink({ phone, text = '' } = {}) {
  const p = new URLSearchParams();
  if (phone) p.set('phone', normalizePhone(phone));
  if (text) p.set('text', String(text));
  return `https://web.whatsapp.com/send?${p.toString()}`;
}

/** פותח וואטסאפ בלשונית חדשה. יש לקרוא מתוך לחיצה של המשתמש (אחרת הדפדפן חוסם). */
export function openWhatsApp({ phone, text, web = false } = {}) {
  const url = web ? whatsappWebLink({ phone, text }) : whatsappLink({ phone, text });
  const w = window.open(url, '_blank', 'noopener');
  if (!w) throw new Error('הדפדפן חסם את פתיחת החלון – אפשר חלונות קופצים לאתר');
  return url;
}

/** ממלא {{שם}} בערכים. שדה חסר → שגיאה (כדי לא לשלוח "{{name}}" ללקוח). */
export function fillTemplate(template, vars = {}) {
  return String(template).replace(/\{\{\s*([\w֐-׿.]+)\s*\}\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), vars);
    if (v == null) throw new Error(`חסר ערך לשדה {{${key}}} בתבנית`);
    return String(v);
  });
}

/**
 * רשימת תפוצה: מכין קישור לכל נמען (שליחה אחת-אחת, לחיצה לכל אחד – וואטסאפ לא מאפשר שליחה המונית בקישורים).
 * recipients: [{ phone, ...vars }] → [{ phone, url, text, error? }]
 */
export function prepareBatch(recipients, template) {
  return recipients.map((r) => {
    try {
      const text = fillTemplate(template, r);
      return { phone: normalizePhone(r.phone), text, url: whatsappLink({ phone: r.phone, text }) };
    } catch (e) { return { phone: r.phone, error: e.message }; }
  });
}
