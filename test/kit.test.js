import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidEmail, parseAddresses, normalizeMessage, buildMime, encodeHeader, gmailComposeUrl, mailtoUrl, fillTemplate, htmlToText,
} from '../email/email.js';
import { normalizePhone, isMobileIL, whatsappLink, whatsappWebLink, prepareBatch } from '../whatsapp/whatsapp.js';

const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, '')), (c) => c.charCodeAt(0)));

describe('email: כתובות והודעה', () => {
  test('כתובות תקינות/לא תקינות', () => {
    assert.ok(isValidEmail('a.b+c@school.org.il'));
    assert.ok(!isValidEmail('אבג@'));
    assert.deepEqual(parseAddresses('a@x.com; b@y.co.il ,'), ['a@x.com', 'b@y.co.il']);
    assert.throws(() => parseAddresses('a@x.com, bad'), /לא תקינה: bad/);
  });
  test('חובה: נמען, נושא, תוכן', () => {
    assert.throws(() => normalizeMessage({ subject: 's', text: 't' }), /נמען/);
    assert.throws(() => normalizeMessage({ to: 'a@x.com', text: 't' }), /נושא/);
    assert.throws(() => normalizeMessage({ to: 'a@x.com', subject: 's' }), /תוכן/);
  });
});

describe('email: MIME', () => {
  test('נושא בעברית מקודד RFC 2047, גוף UTF-8 base64', () => {
    const mime = buildMime({ to: 'a@x.com', subject: 'קבלה מס׳ 5', text: 'שלום, מצורפת קבלה.' });
    assert.match(mime, /^To: a@x\.com\r\n/m);
    const subj = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(mime)[1];
    assert.equal(b64decode(subj), 'קבלה מס׳ 5');
    const body = mime.split('\r\n\r\n')[1];
    assert.equal(b64decode(body), 'שלום, מצורפת קבלה.');
    assert.equal(encodeHeader('Receipt'), 'Receipt');
  });
  test('text + html → multipart/alternative', () => {
    const mime = buildMime({ to: 'a@x.com', subject: 's', text: 'טקסט', html: '<b>html</b>' });
    assert.match(mime, /Content-Type: multipart\/alternative; boundary="([^"]+)"/);
    assert.match(mime, /text\/plain; charset=UTF-8/);
    assert.match(mime, /text\/html; charset=UTF-8/);
  });
  test('קובץ מצורף → multipart/mixed, base64 בשורות של 76 תווים, שם קובץ בעברית', () => {
    const data = new Uint8Array(500).map((_, i) => i % 256);
    const mime = buildMime({ to: 'a@x.com', subject: 's', text: 't',
      attachments: [{ filename: 'קבלה-5.pdf', mimeType: 'application/pdf', data }] });
    const boundary = /multipart\/mixed; boundary="([^"]+)"/.exec(mime)[1];
    const parts = mime.split(`--${boundary}`);
    assert.equal(parts.length, 4);                      // preamble, body, attachment, closing
    const att = parts[2];
    assert.match(att, /Content-Disposition: attachment; filename="=\?UTF-8\?B\?/);
    const lines = att.split('\r\n\r\n')[1].trim().split('\r\n');
    assert.ok(lines.every((l) => l.length <= 76));
    const back = Uint8Array.from(atob(lines.join('')), (c) => c.charCodeAt(0));
    assert.deepEqual([...back], [...data]);
    assert.match(mime, new RegExp(`--${boundary}--$`));
  });
  test('Cc/Bcc/Reply-To בכותרות', () => {
    const mime = buildMime({ to: ['a@x.com', 'b@x.com'], cc: 'c@x.com', bcc: 'd@x.com', replyTo: 'r@x.com', subject: 's', text: 't' });
    assert.match(mime, /^To: a@x\.com, b@x\.com$/m);
    assert.match(mime, /^Cc: c@x\.com$/m);
    assert.match(mime, /^Bcc: d@x\.com$/m);
    assert.match(mime, /^Reply-To: r@x\.com$/m);
  });
});

describe('email: טיוטה ותבניות', () => {
  test('קישור טיוטה ל-Gmail ו-mailto', () => {
    const u = new URL(gmailComposeUrl({ to: 'a@x.com', subject: 'נושא', text: 'גוף' }));
    assert.equal(u.searchParams.get('to'), 'a@x.com');
    assert.equal(u.searchParams.get('su'), 'נושא');
    assert.equal(u.searchParams.get('body'), 'גוף');
    assert.match(mailtoUrl({ to: 'a@x.com', subject: 'נושא', text: 'גוף' }), /^mailto:a%40x\.com\?subject=%D7%A0/);
  });
  test('html → text לטיוטה', () => {
    assert.equal(htmlToText('<p>שלום</p><p>עולם<br>שורה</p>'), 'שלום\nעולם\nשורה');
  });
  test('תבנית: מילוי שדות, ושדה חסר נחסם', () => {
    assert.equal(fillTemplate('שלום {{name}}, סכום {{doc.total}} ₪', { name: 'דנה', doc: { total: '450' } }), 'שלום דנה, סכום 450 ₪');
    assert.throws(() => fillTemplate('שלום {{name}}', {}), /חסר ערך לשדה \{\{name\}\}/);
  });
});

describe('whatsapp', () => {
  test('נרמול מספרים ישראליים וזרים', () => {
    assert.equal(normalizePhone('050-123-4567'), '972501234567');
    assert.equal(normalizePhone('+972 50 123 4567'), '972501234567');
    assert.equal(normalizePhone('00972501234567'), '972501234567');
    assert.equal(normalizePhone('+972 050 1234567'), '972501234567');
    assert.equal(normalizePhone('03-6123456'), '97236123456');
    assert.equal(normalizePhone('+1 (212) 555-0100'), '12125550100');
    assert.throws(() => normalizePhone('12'), /לא תקין/);
    assert.throws(() => normalizePhone('050-12'), /לא תקין/);
    assert.ok(isMobileIL('0521234567'));
    assert.ok(!isMobileIL('03-6123456'));
  });
  test('קישור wa.me עם טקסט בעברית', () => {
    const u = whatsappLink({ phone: '050-1234567', text: 'שלום! הקבלה מצורפת\nתודה' });
    assert.match(u, /^https:\/\/wa\.me\/972501234567\?text=/);
    assert.equal(decodeURIComponent(u.split('text=')[1]), 'שלום! הקבלה מצורפת\nתודה');
    assert.equal(whatsappLink({ text: 'x' }), 'https://wa.me/?text=x');
    assert.equal(new URL(whatsappWebLink({ phone: '0501234567', text: 'היי' })).searchParams.get('phone'), '972501234567');
    assert.throws(() => whatsappLink({ phone: '0501234567', text: 'x'.repeat(4001) }), /ארוכה/);
  });
  test('רשימת תפוצה: קישור לכל נמען, שגיאות לא עוצרות את השאר', () => {
    const r = prepareBatch([{ phone: '0501111111', name: 'דנה' }, { phone: 'xx', name: 'יוסי' }, { phone: '0502222222' }], 'שלום {{name}}');
    assert.equal(r[0].text, 'שלום דנה');
    assert.match(r[1].error, /לא תקין/);
    assert.match(r[2].error, /חסר ערך/);
  });
});
