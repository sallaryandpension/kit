# kit: אפליקציות משנה עצמאיות

שני כלים שאפשר להשתמש בהם לבד או מתוך קוד אחר. הם רצים בדפדפן, ואין להם תלויות או שרת.

| כלי | קובץ ליבה | דף עצמאי |
|---|---|---|
| ✉️ מייל | `email/email.js` | `email/index.html` |
| 💬 וואטסאפ | `whatsapp/whatsapp.js` | `whatsapp/index.html` |

בדיקות: `npm test`. הבדיקות לא שולחות כלום, רק בונות הודעות וקישורים ובודקות אותם.

---

## שימוש מתוך קוד אחר

### 1. ייבוא ישיר (באותו אתר, או בהעתקת הקובץ)
```js
import { openGmailDraft, GmailSender, fillTemplate } from './kit/email/email.js';
import { openWhatsApp, whatsappLink, prepareBatch } from './kit/whatsapp/whatsapp.js';

// טיוטה ב-Gmail (מתוך לחיצה של המשתמש)
openGmailDraft({ to: 'client@school.org.il', subject: 'קבלה מס׳ 12', text: 'שלום, מצורפת הקבלה.' });

// וואטסאפ עם תבנית
const text = fillTemplate('שלום {{name}}, הקבלה על סך {{sum}} ₪ נשלחה במייל.', { name: 'דנה', sum: '1,350' });
openWhatsApp({ phone: '050-1234567', text });
```

### 2. פתיחה בקישור (בלי לייבא קוד)
```
email/?to=client@x.com&subject=קבלה&text=שלום
whatsapp/?phone=0501234567&text=שלום
```
כל אפליקציה יכולה לבנות קישור כזה ולפתוח אותו. הדף נפתח עם כל השדות מלאים.

---

## ✉️ מייל: `email/email.js`

| פונקציה | מה עושה |
|---|---|
| `openGmailDraft(msg)` | פותח טיוטה מוכנה ב-Gmail. **בלי הגדרות.** אין קבצים מצורפים |
| `gmailComposeUrl(msg)` / `mailtoUrl(msg)` | מחזירות את הקישור עצמו |
| `new GmailSender({ clientId })` | שליחה אוטומטית: `await s.connect()` (מתוך לחיצה) ← `await s.send(msg)` |
| `buildMime(msg)` | בונה הודעת MIME מלאה: עברית, HTML וקבצים מצורפים |
| `fillTemplate(tpl, vars)` | ממלא `{{שדה}}`. אם שדה חסר, זורקת שגיאה, כדי שלא יישלח `{{name}}` ללקוח |
| `isValidEmail`, `parseAddresses`, `normalizeMessage` | בדיקות לפני שליחה |

**מבנה הודעה:**
```js
{ to: 'a@x.com' | ['a@x.com', 'b@y.com'], cc?, bcc?, replyTo?, subject, text?, html?,
  attachments?: [{ filename: 'קבלה-12.pdf', mimeType: 'application/pdf', data: Uint8Array | base64 }] }
```

### הגדרה חד-פעמית לשליחה אוטומטית (Gmail API)
אפשר לדלג על השלב הזה: "טיוטה ב-Gmail" עובדת בלעדיו.
1. נכנסים ל-https://console.cloud.google.com עם חשבון ה-Gmail שממנו שולחים, ויוצרים פרויקט חדש (חינם).
2. **APIs & Services ← Library** ← מחפשים **Gmail API** ← **Enable**.
3. **OAuth consent screen**:
   - סוג **External**, שם אפליקציה (למשל "kit"), ואימייל.
   - Scopes: מוסיפים רק `.../auth/gmail.send`.
   - **Test users**: מוסיפים את כתובת ה-Gmail שלך.
   - משאירים את האפליקציה במצב **Testing**. אין צורך באימות של Google לשימוש אישי.
4. **Credentials ← Create credentials ← OAuth client ID**:
   - סוג **Web application**.
   - **Authorized JavaScript origins**: מוסיפים את כתובת האתר שבו הכלי רץ, למשל `https://sallaryandpension.github.io`, וגם `http://localhost:5181` לבדיקות.
5. מעתיקים את ה-**Client ID** (מסתיים ב-`.apps.googleusercontent.com`) לשדה בדף המייל, ולוחצים "התחבר ל-Gmail".

**אבטחה:**
- ההרשאה היא `gmail.send` בלבד: שליחה, בלי קריאת מיילים.
- ההרשאה (token) נשמרת בזיכרון בלבד, לשעה.
- ה-Client ID אינו סוד. **אין Client Secret ואין סיסמה בקוד.**

---

## 💬 וואטסאפ: `whatsapp/whatsapp.js`

| פונקציה | מה עושה |
|---|---|
| `openWhatsApp({ phone?, text, web? })` | פותח את וואטסאפ על השיחה, עם הטקסט מוכן. המשתמש לוחץ "שלח" |
| `whatsappLink({ phone?, text })` | `https://wa.me/972...?text=...`. בלי טלפון, וואטסאפ שואל למי לשלוח |
| `whatsappWebLink(...)` | קישור ישיר ל-WhatsApp Web |
| `normalizePhone('050-1234567')` | `'972501234567'`. תומך ב-`+972`, ב-`00972` ובמספרים זרים עם `+` |
| `prepareBatch(recipients, template)` | קישור אישי לכל נמען. שגיאה בנמען אחד לא עוצרת את השאר |
| `fillTemplate(tpl, vars)` | כמו במייל |

**למה לא שליחה אוטומטית לגמרי?**
- הדרך הרשמית היחידה היא WhatsApp Business Cloud API. היא דורשת מספר עסקי נפרד, חשבון Meta Business, תבניות הודעה מאושרות ותשלום.
- אוטומציה של הוואטסאפ הפרטי מפרה את תנאי השימוש, ומסכנת חסימה של המספר.
- אם יידרש בעתיד, אפשר להוסיף כאן `CloudApiSender` בלי לשנות את שאר הקוד.

---

## הערות
- `openGmailDraft` ו-`openWhatsApp` צריכות לרוץ **מתוך לחיצה של המשתמש**. אחרת הדפדפן חוסם את החלון החדש.
- כל שליחה היא פעולה שלך: הכלים מכינים את ההודעה, ואתה מאשר. השליחה האוטומטית במייל מבקשת אישור לפני כל שליחה.
