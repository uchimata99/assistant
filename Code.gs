/**
 * העוזר — שרת אפס סקריפט (גרסה לשני חשבונות)
 * אותו קובץ נפרס פעמיים: פעם בחשבון גוגל של אש, פעם בחשבון של מיכל.
 *
 * הגדרה חד־פעמית בכל חשבון (הרצה מתוך העורך):
 *   1. הרץ את setup() פעם אחת — מבקש הרשאות, יוצר גיליון מטלות פרטי.
 *   2. הגדרות פרויקט → מאפייני סקריפט:
 *        ANTHROPIC_API_KEY  = המפתח (אפשר אותו מפתח בשני החשבונות)
 *        MODEL              = claude-sonnet-4-5
 *        SHARED_SHEET_ID    = מזהה של גיליון אחד משותף (ראו למטה)
 *   3. פרסום → פריסה חדשה → יישום אינטרנט → ביצוע כ: אני; גישה: כל אחד → הכתובת לאפליקציה.
 *
 * הגיליון המשותף: בחשבון הראשון מריצים createSharedSheet() — הוא יוצר גיליון, מדפיס את המזהה,
 * ואת המזהה הזה מכניסים ל־SHARED_SHEET_ID בשני החשבונות. אחר כך משתפים את הגיליון (עריכה)
 * עם החשבון השני מתוך גוגל דרייב.
 */

const PROPS = PropertiesService.getScriptProperties();
const TZ = Session.getScriptTimeZone();
const TASK_HEADER = ['מזהה', 'כותרת', 'כובע', 'תגים', 'חשיבות', 'תאריך יעד', 'מהותית', 'בוצע', 'מי הוסיף', 'נוצר'];

function doGet() { return json_({ ok: true, service: 'assistant', tz: TZ }); }

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents || '{}');
    switch (b.action) {
      case 'ping':           return json_({ ok: true, calendars: calendars_(), model: model_(), sharedSheet: !!PROPS.getProperty('SHARED_SHEET_ID') });
      case 'agenda':         return json_(agenda_(b.days || 35));
      case 'calendars':      return json_({ calendars: calendars_() });
      case 'createCalendar': return json_(createCalendar_(b));
      case 'createEvent':    return json_(createEvent_(b));
      case 'deleteEvent':    return json_(deleteEvent_(b.id, b.calendarId));
      case 'tasks':          return json_({ tasks: listTasks_() });
      case 'addTask':        return json_(addTask_(b));
      case 'updateTask':     return json_(updateTask_(b));
      case 'deleteTask':     return json_(deleteTask_(b));
      case 'createDraft':    return json_(createDraft_(b));
      case 'chat':           return json_(chat_(b));
      default:               return json_({ error: 'פעולה לא מוכרת: ' + b.action });
    }
  } catch (err) { return json_({ error: String(err && err.message || err) }); }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- יומנים ---------- */
function visibleCalendars_() {
  return CalendarApp.getAllCalendars().filter(c => c.isSelected() && !/holiday|חג|birthday|ימי הולדת/i.test(c.getName()));
}
function calendars_() {
  return visibleCalendars_().map(c => ({ id: c.getId(), name: c.getName(), color: c.getColor(), primary: c.isMyPrimaryCalendar() }));
}
function calById_(id) {
  if (!id) return CalendarApp.getDefaultCalendar();
  const c = CalendarApp.getCalendarById(id);
  if (!c) throw new Error('היומן לא נמצא');
  return c;
}
function createCalendar_(b) {
  if (!b.name) throw new Error('חסר שם ליומן');
  const c = CalendarApp.createCalendar(b.name, { color: b.color || undefined, timeZone: TZ, selected: true });
  log_('createCalendar', b.name);
  return { ok: true, id: c.getId(), name: c.getName() };
}
function agenda_(days) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + days);
  const evs = [];
  visibleCalendars_().forEach(c => {
    const cid = c.getId(), mine = c.isMyPrimaryCalendar();
    c.getEvents(start, end).forEach(ev => {
      if (ev.isAllDayEvent()) return;
      evs.push({ id: ev.getId(), calendarId: cid, calendarName: c.getName(), shared: !mine,
        title: ev.getTitle(), start: ev.getStartTime().toISOString(), end: ev.getEndTime().toISOString(), location: ev.getLocation() || '' });
    });
  });
  evs.sort((a, b) => a.start < b.start ? -1 : 1);
  return { events: evs, calendars: calendars_() };
}
function createEvent_(b) {
  const cal = calById_(b.calendarId);
  const ev = cal.createEvent(b.title, new Date(b.start), new Date(b.end), { location: b.location || '', description: b.description || '' });
  log_('createEvent', cal.getName() + ' | ' + b.title + ' ' + b.start);
  return { ok: true, id: ev.getId(), calendarId: cal.getId() };
}
function deleteEvent_(id, calendarId) {
  const cals = calendarId ? [calById_(calendarId)] : visibleCalendars_();
  for (const c of cals) { const ev = c.getEventById(id); if (ev) { const t = ev.getTitle(); ev.deleteEvent(); log_('deleteEvent', t); return { ok: true }; } }
  throw new Error('האירוע לא נמצא');
}

/* ---------- מטלות: גיליון פרטי + גיליון משותף ---------- */
function privateSheet_() {
  let id = PROPS.getProperty('SHEET_ID'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { id = null; } }
  if (!id) {
    ss = SpreadsheetApp.create('העוזר — מטלות (פרטי)');
    PROPS.setProperty('SHEET_ID', ss.getId());
    ss.getActiveSheet().setName('מטלות').appendRow(TASK_HEADER);
    ss.insertSheet('לוג').appendRow(['זמן', 'פעולה', 'פרטים']);
  }
  return ss;
}
function sharedSheet_() {
  const id = PROPS.getProperty('SHARED_SHEET_ID');
  if (!id) return null;
  return SpreadsheetApp.openById(id);
}
function taskTab_(shared) {
  const ss = shared ? sharedSheet_() : privateSheet_();
  if (!ss) throw new Error('הגיליון המשותף לא מוגדר. הריצו createSharedSheet ומלאו SHARED_SHEET_ID.');
  let sh = ss.getSheetByName('מטלות');
  if (!sh) { sh = ss.insertSheet('מטלות'); sh.appendRow(TASK_HEADER); }
  return sh;
}
function rowToTask_(r, shared) {
  return { id: String(r[0]), title: r[1], hat: r[2], tags: String(r[3] || '').split(',').map(s => s.trim()).filter(Boolean),
    importance: r[4] || 'normal', due: r[5] ? fmtDate_(r[5]) : '', mit: r[6] === true || r[6] === 'TRUE',
    done: r[7] ? (r[7] === true || r[7] === 'TRUE' ? 'yes' : fmtDate_(r[7])) : false, author: r[8] || '', shared: shared };
}
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v); }
function listTasks_() {
  const out = [];
  const read = (sh, shared) => { if (!sh) return; const vals = sh.getDataRange().getValues(); for (let i = 1; i < vals.length; i++) if (vals[i][0]) out.push(rowToTask_(vals[i], shared)); };
  read(taskTab_(false), false);
  const ss = sharedSheet_(); if (ss) read(ss.getSheetByName('מטלות'), true);
  // מטלות שסומנו כבוצעו לפני יותר משבוע לא נשלחות
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  return out.filter(t => !t.done || t.done === 'yes' || new Date(t.done) > cutoff);
}
function addTask_(t) {
  taskTab_(!!t.shared).appendRow([t.id, t.title, t.hat || '', (t.tags || []).join(','), t.importance || 'normal', t.due || '', !!t.mit, t.done ? t.done : '', t.author || '', new Date()]);
  log_('addTask', (t.shared ? '[משותף] ' : '') + t.title);
  return { ok: true };
}
function findTask_(id, shared) {
  const sh = taskTab_(!!shared); const vals = sh.getDataRange().getValues();
  for (let r = 1; r < vals.length; r++) if (String(vals[r][0]) === String(id)) return { sh, row: r + 1 };
  return null;
}
function updateTask_(b) {
  const f = findTask_(b.id, b.shared); if (!f) return { ok: false };
  if ('mit' in b) f.sh.getRange(f.row, 7).setValue(!!b.mit);
  if ('done' in b) f.sh.getRange(f.row, 8).setValue(b.done ? Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') : '');
  if ('title' in b) f.sh.getRange(f.row, 2).setValue(b.title);
  return { ok: true };
}
function deleteTask_(b) { const f = findTask_(b.id, b.shared); if (f) f.sh.deleteRow(f.row); return { ok: !!f }; }
function log_(action, details) { try { privateSheet_().getSheetByName('לוג').appendRow([new Date(), action, details]); } catch (e) {} }

/* ---------- ג'ימייל: טיוטה בלבד ---------- */
function createDraft_(b) { GmailApp.createDraft(b.to || '', b.subject || '', b.body || ''); log_('createDraft', b.subject || ''); return { ok: true }; }

/* ---------- שיחה עם קלוד ---------- */
function model_() { return PROPS.getProperty('MODEL') || 'claude-sonnet-4-5'; }
function chat_(b) {
  const key = PROPS.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('חסר מפתח: הגדירו ANTHROPIC_API_KEY במאפייני הסקריפט');
  const ctx = b.context || {};
  const fem = ctx.gender === 'f';
  const system = [
    'אתה עוזר אישי של ' + (ctx.me || 'המשתמש') + '. ' + (fem ? 'פנה אליה בלשון נקבה.' : 'פנה אליו בלשון זכר.') + ' ענה בעברית, קצר וישיר, בלי מילות ריצוד.',
    'זהו מכשיר של אחד משני בני הזוג (אש ומיכל). לכל אחד עוזר משלו; מה שמסומן "משותף" נראה אצל שניהם.',
    'הכובעים (הקשרים) של ' + (ctx.me || '') + ': ' + JSON.stringify(ctx.hats || []) + '. היום הוא יום ' + (ctx.dayHat || 'ללא כובע') + '.',
    'תגים = הילדים: ' + JSON.stringify(ctx.tags || []) + '. כשמוזכר ילד בשם או בכינוי, מלא tags עם שמו; כשיש תג, הכובע הוא family והפריט משותף.',
    'הזמן עכשיו: ' + (ctx.now || new Date().toISOString()) + ' (אזור זמן ' + (ctx.tz || TZ) + '). תאריכים יחסיים ("מחר", "ביום שלישי") מחושבים מהזמן הזה.',
    'אירועים בימים הקרובים (כולל משותפים): ' + JSON.stringify(ctx.events || []),
    'מטלות פתוחות (עם מי הוסיף): ' + JSON.stringify(ctx.tasks || []),
    'מגבלת המטלות המהותיות ליום: ' + (ctx.mitmax || 3) + '.',
    '',
    'כלל יסוד: אתה מציע, לא מבצע. כל פגישה, מטלה או מייל חוזרים כהצעה שמאושרת בלחיצה. מייל נשמר כטיוטה בלבד.',
    'פרטי או משותף: shared=true כשמדובר בילד, במשפחה, בבית, או כשנאמר במפורש "משותף", "לשנינו", "שמיכל תראה", "שאש יראה". אחרת shared=false והפריט נשאר פרטי ביומן האישי. תמיד אפשר לשנות בכרטיס.',
    'תמונות והודעות מועברות: אם צורפה תמונה (צילום מסך של ווטסאפ, הזמנה, לוח חוגים, מכתב מבית הספר) או הודבק טקסט מועבר — חלץ ממנו את כל האירועים והמטלות, כל אחד כהצעה נפרדת עם תאריך ושעה מדויקים. אם השנה חסרה, הנח את המועד הקרוב הבא. ציין ב־why מאיפה נלקח כל פרט. אם משהו לא ברור בתמונה, שאל במקום לנחש.',
    'כשיש התנגשות ביומן, או שהבקשה חודרת ליום של כובע אחר, ציין זאת ב־why. הפרד בין חשוב לדחוף.',
    '',
    'החזר אך ורק אובייקט JSON תקין, בלי טקסט מסביב ובלי סימני קוד:',
    '{"reply":"טקסט קצר בעברית","proposals":[',
    ' {"type":"event","title":"...","start":"ISO עם אזור זמן","end":"ISO","location":"","hat":"מפתח כובע","tags":["שם ילד"],"shared":false,"why":"..."},',
    ' {"type":"task","title":"...","hat":"...","tags":[],"shared":false,"importance":"high|normal","due":"YYYY-MM-DD","mit":false,"why":"..."},',
    ' {"type":"email_draft","to":"","subject":"...","body":"...","hat":"...","why":"..."}',
    ']}',
    'אם אין פעולה להציע, proposals ריק.',
  ].join('\n');

  const history = (b.history || []).filter(m => m && m.content && m.role);
  const content = [];
  (b.images || []).forEach(data => content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data } }));
  content.push({ type: 'text', text: b.message || 'מה יש כאן? חלץ אירועים ומטלות.' });
  const messages = history.concat([{ role: 'user', content: content }]);

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post', contentType: 'application/json',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify({ model: model_(), max_tokens: 2000, system: system, messages: messages }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode(); const data = JSON.parse(res.getContentText());
  if (code >= 300) throw new Error('שגיאת מנוע ' + code + ': ' + (data.error && data.error.message || res.getContentText()));
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  let out;
  try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { out = { reply: text, proposals: [] }; }
  out.proposals = Array.isArray(out.proposals) ? out.proposals : [];
  log_('chat', (b.message || '(תמונה)').slice(0, 120));
  return out;
}

/* ---------- הגדרה חד־פעמית ---------- */
function setup() {
  CalendarApp.getAllCalendars().length;
  privateSheet_();
  GmailApp.getDrafts();
  Logger.log('מוכן. גיליון פרטי: ' + PROPS.getProperty('SHEET_ID') + ' | גיליון משותף: ' + (PROPS.getProperty('SHARED_SHEET_ID') || 'לא מוגדר'));
}
// מריצים פעם אחת, בחשבון אחד בלבד. את המזהה שמודפס מכניסים ל־SHARED_SHEET_ID בשני החשבונות.
function createSharedSheet() {
  const ss = SpreadsheetApp.create('העוזר — משותף (אש ומיכל)');
  ss.getActiveSheet().setName('מטלות').appendRow(TASK_HEADER);
  PROPS.setProperty('SHARED_SHEET_ID', ss.getId());
  Logger.log('SHARED_SHEET_ID = ' + ss.getId() + '\nכתובת: ' + ss.getUrl() + '\nעכשיו לשתף את הגיליון (עריכה) עם החשבון השני, ולהכניס את המזהה גם אצלו.');
}
