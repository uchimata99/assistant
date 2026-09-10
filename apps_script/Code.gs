/**
 * העוזר — שרת אפס סקריפט (גרסה לשני חשבונות)
 * אותו קובץ נפרס פעמיים: פעם בחשבון הגוגל של כל אחד משני בני הזוג.
 *
 * הגדרה חד־פעמית בכל חשבון (הרצה מתוך העורך):
 *   1. הרץ את setup() פעם אחת — מבקש הרשאות, יוצר גיליון מטלות פרטי.
 *   2. הגדרות פרויקט → מאפייני סקריפט:
 *        ANTHROPIC_API_KEY  = המפתח (אפשר אותו מפתח בשני החשבונות)
 *        MODEL              = claude-sonnet-5
 *        SHARED_SHEET_ID    = מזהה של גיליון אחד משותף (ראו למטה)
 *        APP_SECRET         = סוד משותף. setup() מייצר אותו ומדפיס אותו ביומן ההרצה.
 *                             מעתיקים אותו לשדה "סוד" בהגדרות האפליקציה, בכל מכשיר.
 *                             בלעדיו הפריסה פתוחה לכל מי שמכיר את הכתובת.
 *   3. פרסום → פריסה חדשה → יישום אינטרנט → ביצוע כ: אני; גישה: כל אחד → הכתובת לאפליקציה.
 *
 * הגיליון המשותף: בחשבון הראשון מריצים createSharedSheet() — הוא יוצר גיליון, מדפיס את המזהה,
 * ואת המזהה הזה מכניסים ל־SHARED_SHEET_ID בשני החשבונות. אחר כך משתפים את הגיליון (עריכה)
 * עם החשבון השני מתוך גוגל דרייב.
 */

const PROPS = PropertiesService.getScriptProperties();
const TZ = Session.getScriptTimeZone();
// עמודת "כובע" נשמרת ריקה: המושג בוטל, והעמודה נשארת כדי לא להזיז עמודות בגיליון קיים.
const TASK_HEADER = ['מזהה', 'כותרת', '(לא בשימוש)', 'תגים', 'חשיבות', 'תאריך יעד', 'מהותית', 'בוצע', 'מי הוסיף', 'נוצר', 'פריטים'];
const LOG_HEADER = ['זמן', 'פעולה', 'פרטים', 'מזהה אירוע', 'מזהה יומן'];

function doGet() { return json_({ ok: true, service: 'assistant', tz: TZ }); }

function doPost(e) {
  try {
    const b = JSON.parse(e.postData.contents || '{}');
    const secret = PROPS.getProperty('APP_SECRET');
    if (secret && b.secret !== secret) {
      // ping עונה תשובה מסבירה כדי שאפשר יהיה לאבחן מההגדרות; כל השאר נחסם.
      if (b.action === 'ping') return json_({ ok: false, secretRequired: true, error: 'הסוד לא תואם. העתיקו את הערך של APP_SECRET לשדה הסוד בהגדרות.' });
      return json_({ error: 'אין הרשאה. חסר סוד תואם בבקשה.' });
    }
    switch (b.action) {
      case 'ping':           ensureShared_(); return json_({ ok: true, calendars: calendars_(), model: model_(), sharedSheet: !!PROPS.getProperty('SHARED_SHEET_ID'), secured: !!secret, digest: digestConfig_(), partner: !!PROPS.getProperty('PARTNER_EMAIL') });
      case 'agenda':         return json_(agenda_(b.days || 35));
      case 'calendars':      return json_({ calendars: calendars_() });
      case 'colors':         return json_(colors_());
      case 'shareCalendar':  return json_(shareCalendar_(b));
      case 'shareAll':       return json_(shareAllCalendars_());
      case 'updateCalendar': return json_(updateCalendar_(b));
      case 'deleteCalendar': return json_(deleteCalendar_(b));
      case 'createCalendar': return json_(createCalendar_(b));
      case 'createEvent':    return json_(createEvent_(b));
      case 'deleteEvent':    return json_(deleteEvent_(b.id, b.calendarId, b.series));
      case 'tasks':          return json_({ tasks: listTasks_() });
      case 'addTask':        return json_(addTask_(b));
      case 'updateTask':     return json_(updateTask_(b));
      case 'deleteTask':     return json_(deleteTask_(b));
      case 'syncTasks':      return json_(syncGoogleTasks_());
      case 'createDraft':    return json_(createDraft_(b));
      case 'log':            return json_({ entries: readLog_(b.limit || 120) });
      case 'digest':         return json_(digest_(b));
      case 'setDigest':      return json_(setDigest_(b));
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
// פלטת הצבעים של יומן גוגל. גוגל תומך רק בקבוצה סגורה של צבעים ומצמיד כל גוון אחר
// לקרוב אליו, ולכן בורר צבע חופשי באפליקציה יוצר פער בין מה שנבחר למה שנראה ביומן.
// נקרא ישירות מממשק היומן עם האסימון של הסקריפט, כדי שלא נחזיק עותק שעלול להתיישן.
// שיתוף יומן אינו נתמך בשירות המובנה — c.addEditor אינו קיים על יומן, רק על גיליון.
// היחיד שעובד הוא ממשק היומן עצמו, ולכן צריך שהוא יהיה מופעל בפרויקט הענן.
function shareCal_(calendarId, email) {
  const url = 'https://www.googleapis.com/calendar/v3/calendars/' +
              encodeURIComponent(calendarId) + '/acl';
  const r = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ role: 'writer', scope: { type: 'user', value: email } }),
    muteHttpExceptions: true,
  });
  const code = r.getResponseCode();
  if (code === 200 || code === 201) return true;
  throw new Error('קוד ' + code + ': ' + r.getContentText().slice(0, 160));
}
// בקשות שינוי מהמשתמשים. נכתבות לגיליון המשותף, כדי ששני בני הזוג יראו את אותה רשימה
// וכדי שאפשר יהיה לקרוא אותן בסשן עבודה הבא בלי לתלות את זה בזיכרון של מישהו.
function colors_() {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/colors', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error('לא הצלחתי לקרוא את פלטת הצבעים מגוגל (' + r.getResponseCode() + ')');
  const cal = JSON.parse(r.getContentText()).calendar || {};
  const list = Object.keys(cal).map(k => ({ id: k, bg: cal[k].background, fg: cal[k].foreground }));
  return { colors: list };
}

function createCalendar_(b) {
  if (!b.name) throw new Error('חסר שם ליומן');
  const c = CalendarApp.createCalendar(b.name, { color: b.color || undefined, timeZone: TZ, selected: true });
  // כתובת בן/בת הזוג יושבת במאפייני הסקריפט ולא בקוד, כי המאגר ציבורי.
  // מגדירים אותה פעם אחת בכל חשבון, כמו המפתח של אנתרופיק.
  let shared = '';
  const partner = PROPS.getProperty('PARTNER_EMAIL');
  if (partner) {
    try { shareCal_(c.getId(), partner); shared = partner; }
    catch (err) { log_('createCalendar', 'היומן נוצר אך השיתוף נכשל: ' + err.message); }
  }
  log_('createCalendar', b.name + (shared ? ' · שותף עם ' + shared : ''));
  return { ok: true, id: c.getId(), name: c.getName(), shared: shared };
}
function shareCalendar_(b) {
  // הכתובת מגיעה מהכספת. האפליקציה אינה שולחת אותה, כדי שלא תשב בקוד הציבורי.
  const email = b.email || PROPS.getProperty('PARTNER_EMAIL');
  if (!b.id) throw new Error('חסר מזהה יומן');
  if (!email) throw new Error('לא הוגדר PARTNER_EMAIL במאפייני הסקריפט');
  const c = CalendarApp.getCalendarById(b.id);
  if (!c) throw new Error('לא נמצא יומן כזה');
  shareCal_(c.getId(), String(email));
  log_('shareCalendar', c.getName() + ' · ' + email);
  return { ok: true, email: String(email), name: c.getName() };
}
// מדיניות קבועה: כל היומנים משותפים בין בני הזוג, חוץ מהיומן האישי הראשי.
// נאכף בכל חיבור, ולכן יומן שנוצר ידנית ביומן גוגל משותף גם הוא בלי לעשות דבר.
function ensureShared_() {
  const email = PROPS.getProperty('PARTNER_EMAIL');
  if (!email) return 0;
  let n = 0;
  try {
    CalendarApp.getAllOwnedCalendars().forEach(c => {
      if (c.isMyPrimaryCalendar()) return;
      try { shareCal_(c.getId(), email); n++; } catch (err) {}
    });
  } catch (err) {}
  // גם הגיליון המשותף. בגיליון addEditor כן קיים, בשונה מיומן.
  const sid = PROPS.getProperty('SHARED_SHEET_ID');
  if (sid) {
    try {
      const ss = SpreadsheetApp.openById(sid);
      const has = ss.getEditors().some(u => u.getEmail() === email);
      if (!has) { ss.addEditor(email); n++; }
    } catch (err) {}
  }
  return n;
}
function shareAllCalendars_() {
  const email = PROPS.getProperty('PARTNER_EMAIL');
  if (!email) throw new Error('לא הוגדר PARTNER_EMAIL במאפייני הסקריפט');
  const done = [], failed = [];
  CalendarApp.getAllOwnedCalendars().forEach(c => {
    if (c.isMyPrimaryCalendar()) return;
    try { shareCal_(c.getId(), email); done.push(c.getName()); }
    catch (err) { failed.push(c.getName() + ': ' + err.message); }
  });
  log_('shareCalendar', 'שיתוף מרוכז עם ' + email + ' · ' + done.length + ' יומנים');
  return { ok: true, email: email, shared: done, failed: failed };
}
function updateCalendar_(b) {
  if (!b.id) throw new Error('חסר מזהה יומן');
  const c = CalendarApp.getCalendarById(b.id);
  if (!c) throw new Error('לא נמצא יומן כזה');
  const was = c.getName();
  if (b.name && b.name !== was) c.setName(String(b.name));
  if (b.color) c.setColor(String(b.color));
  log_('updateCalendar', was + (b.name && b.name !== was ? ' ← ' + b.name : '') + (b.color ? ' · צבע' : ''));
  return { ok: true, id: c.getId(), name: c.getName(), color: c.getColor() };
}
function deleteCalendar_(b) {
  if (!b.id) throw new Error('חסר מזהה יומן');
  const c = CalendarApp.getCalendarById(b.id);
  if (!c) throw new Error('לא נמצא יומן כזה');
  // היומן הראשי אינו ניתן למחיקה, וגם אסור שיימחק בטעות
  if (c.isMyPrimaryCalendar()) throw new Error('אי אפשר למחוק את היומן האישי הראשי');
  const name = c.getName();
  c.deleteCalendar();
  log_('deleteCalendar', name);
  return { ok: true };
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
  const opts = { location: b.location || '', description: b.description || '' };
  const r = b.repeat;
  // אירוע חוזר נוצר כסדרה, ורק כשיש תאריך סיום. סדרה בלי סוף ממשיכה לנצח,
  // ולכן האפליקציה חוסמת אישור בלי "עד מתי", והשרת מסרב גם הוא.
  if (r && r.freq) {
    if (!r.until) throw new Error('אירוע חוזר חייב תאריך סיום');
    let rule = CalendarApp.newRecurrence();
    rule = r.freq === 'daily' ? rule.addDailyRule()
         : r.freq === 'monthly' ? rule.addMonthlyRule()
         : rule.addWeeklyRule();
    rule = rule.until(new Date(String(r.until) + 'T23:59:59'));
    const es = cal.createEventSeries(b.title, new Date(b.start), new Date(b.end), rule, opts);
    applyReminders_(es, b.reminders);
    log_('createEvent', cal.getName() + ' | ' + b.title + ' ' + b.start + ' (חוזר עד ' + r.until + ')', es.getId(), cal.getId());
    return { ok: true, id: es.getId(), calendarId: cal.getId(), series: true };
  }
  const ev = cal.createEvent(b.title, new Date(b.start), new Date(b.end), opts);
  // התראות: קופצות באפליקציית יומן גוגל בטלפון. זה ערוץ ההתראות היחיד שלא דורש תשתית נוספת.
  applyReminders_(ev, b.reminders);
  log_('createEvent', cal.getName() + ' | ' + b.title + ' ' + b.start, ev.getId(), cal.getId());
  return { ok: true, id: ev.getId(), calendarId: cal.getId() };
}
function applyReminders_(ev, mins) {
  if (!Array.isArray(mins)) return;   // השדה לא נשלח כלל — משאירים את ברירת המחדל של היומן
  const list = mins;
  ev.removeAllReminders();            // נשלחה רשימה ריקה = בלי תזכורת, וזה מה שקורה
  // גוגל מקבל עד חמש תזכורות, וכל אחת עד ארבעה שבועות מראש.
  list.map(Number).filter(m => !isNaN(m) && m >= 0 && m <= 40320).slice(0, 5)
      .forEach(m => ev.addPopupReminder(m));
}
function deleteEvent_(id, calendarId, series) {
  const cals = calendarId ? [calById_(calendarId)] : visibleCalendars_();
  for (const c of cals) {
    // מזהה של סדרה מחזיר ב-getEventById את המופע הראשון בלבד, ומחיקה שם משאירה
    // את כל השאר. ביטול של אירוע חוזר חייב לעבור דרך הסדרה עצמה.
    if (series) {
      try { const es = c.getEventSeriesById(id); if (es) { const t = es.getTitle(); es.deleteEventSeries(); log_('deleteEvent', t + ' (כל הסדרה)', id, c.getId()); return { ok: true }; } } catch (e) {}
    }
    const ev = c.getEventById(id);
    if (ev) { const t = ev.getTitle(); ev.deleteEvent(); log_('deleteEvent', t, id, c.getId()); return { ok: true }; }
  }
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
    ss.insertSheet('לוג').appendRow(LOG_HEADER);
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
    done: fmtDone_(r[7]), author: r[8] || '', shared: shared, items: parseItems_(r[10]) };
}
// done הוא תמיד מחרוזת: '' כשפתוח, אחרת 'yyyy-MM-dd'. גיליונות ישנים החזיקו גם TRUE.
function fmtDone_(v) {
  if (!v) return '';
  if (v === true || v === 'TRUE' || v === 'yes') return fmtDate_(new Date());
  return fmtDate_(v);
}
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v); }
// רשימת הפריטים נשמרת כ-JSON בתא אחד. עמודה לכל פריט הייתה מחייבת גיליון בגובה משתנה.
function parseItems_(v) {
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(x => x && x.t).map(x => ({ t: String(x.t), d: !!x.d })) : []; }
  catch (e) { return []; }
}
function itemsCell_(items) { return (items && items.length) ? JSON.stringify(items.map(x => ({ t: String(x.t || ''), d: !!x.d }))) : ''; }
function listTasks_() {
  const out = [];
  const read = (sh, shared) => { if (!sh) return; const vals = sh.getDataRange().getValues(); for (let i = 1; i < vals.length; i++) if (vals[i][0]) out.push(rowToTask_(vals[i], shared)); };
  read(taskTab_(false), false);
  const ss = sharedSheet_(); if (ss) read(ss.getSheetByName('מטלות'), true);
  // מטלות שסומנו כבוצעו לפני יותר משבוע לא נשלחות
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
  return out.filter(t => {
    if (!t.done) return true;
    const d = new Date(t.done);
    return isNaN(d.getTime()) ? true : d > cutoff;
  });
}
function addTask_(t) {
  taskTab_(!!t.shared).appendRow([t.id, t.title, t.hat || '', (t.tags || []).join(','), t.importance || 'normal', t.due || '', !!t.mit, t.done ? t.done : '', t.author || '', new Date(), itemsCell_(t.items)]);
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
  if ('done' in b) f.sh.getRange(f.row, 8).setValue(b.done ? (typeof b.done === 'string' ? b.done : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) : '');
  if ('title' in b) f.sh.getRange(f.row, 2).setValue(b.title);
  if ('items' in b) f.sh.getRange(f.row, 11).setValue(itemsCell_(b.items));
  return { ok: true };
}
function deleteTask_(b) { const f = findTask_(b.id, b.shared); if (f) f.sh.deleteRow(f.row); return { ok: !!f }; }
function logTab_() {
  const ss = privateSheet_();
  let sh = ss.getSheetByName('לוג');
  if (!sh) { sh = ss.insertSheet('לוג'); sh.appendRow(LOG_HEADER); }
  return sh;
}
function log_(action, details, eventId, calendarId) {
  try { logTab_().appendRow([new Date(), action, details, eventId || '', calendarId || '']); } catch (e) {}
}
// יומן הפעולות חי בגיליון ולא רק בדפדפן, כדי שניקוי נתוני הדפדפן לא ימחק אותו.
function readLog_(limit) {
  let sh; try { sh = logTab_(); } catch (e) { return []; }
  const last = sh.getLastRow();
  if (last < 2) return [];
  const n = Math.min(limit, last - 1);
  const vals = sh.getRange(last - n + 1, 1, n, LOG_HEADER.length).getValues();
  return vals.map(r => ({
    when: r[0] instanceof Date ? r[0].toISOString() : String(r[0]),
    action: r[1], details: r[2],
    eventId: r[3] || '', calendarId: r[4] || '',
  })).reverse();
}

/* ---------- ג'ימייל: טיוטה בלבד ---------- */
function createDraft_(b) { GmailApp.createDraft(b.to || '', b.subject || '', b.body || ''); log_('createDraft', b.subject || ''); return { ok: true }; }


/* ---------- גשר אל משימות גוגל ---------- */
/*
 * המטלות עצמן חיות בגיליון, כי רק גיליון אפשר לשתף בין שני החשבונות.
 * משימות גוגל הן פרטיות לחשבון, ולכן כל שרת מסנכרן את המטלות שהוא רואה
 * אל רשימת המשימות של בעליו. כך כל אחד רואה אותן ביומן גוגל שלו בטלפון,
 * ובכל זאת שניכם עובדים על אותה רשימה משותפת.
 *
 * הקישור בין מטלה למשימת גוגל נשמר בגיליון הפרטי של כל חשבון, ולכן הוא
 * לעולם לא מתנגש בין שניכם.
 */
// שירות מתקדם ולא קריאות REST ידניות: רק דרך dependencies אפס סקריפט יודע
// שהפרויקט משתמש במשימות, ורק אז הוא מבקש את ההרשאה בהרצה הבאה. עם טוקן ידני
// הבקשה נראתה לו כמו כל קריאת רשת, ולכן לא הופיע מסך אישור והקריאה חזרה 403.
const GT_LIST_NAME = 'העוזר';

function gtListId_() {
  const saved = PROPS.getProperty('GTASKS_LIST_ID');
  if (saved) { try { if (Tasks.Tasklists.get(saved)) return saved; } catch (e) {} }
  const lists = Tasks.Tasklists.list() || {};
  const found = (lists.items || []).filter(function (l) { return l.title === GT_LIST_NAME; })[0];
  const id = found ? found.id : Tasks.Tasklists.insert({ title: GT_LIST_NAME }).id;
  PROPS.setProperty('GTASKS_LIST_ID', id);
  return id;
}

// הרצה ידנית מהעורך, כדי להוציא את מסך האישור על ההרשאה החדשה.
function authorizeTasks() {
  Logger.log('רשימת המשימות: ' + gtListId_());
}

// מיפוי: מזהה המטלה שלנו, מפתח הפריט (ריק = המטלה עצמה), מזהה משימת גוגל.
const GT_MAP_HEADER = ['מזהה מטלה', 'פריט', 'מזהה משימת גוגל'];
function gtMapTab_() {
  const ss = privateSheet_();
  let sh = ss.getSheetByName('קישור למשימות גוגל');
  if (!sh) { sh = ss.insertSheet('קישור למשימות גוגל'); sh.appendRow(GT_MAP_HEADER); }
  return sh;
}
// מחזיר גם כפילויות: שורות ישנות שאותו מפתח קיבל בגללן משימה שנייה בגוגל.
// הן נוצרו בבאג של אינדקס 0, וגם בלעדיו עדיף לנקות אותן ולא לצבור יתומות.
function gtMapRead_(dupOut) {
  const vals = gtMapTab_().getDataRange().getValues();
  const map = {};
  // הפריט הראשון ברשימה הוא אינדקס 0, ו-0 הוא ערך כוזב. `x || ''` הפך אותו למחרוזת
  // ריקה, כלומר למפתח של המטלה עצמה, וכך הפריט הראשון נוצר מחדש בכל סנכרון.
  for (let i = 1; i < vals.length; i++) {
    if (!vals[i][0]) continue;
    const it = vals[i][1];
    const key = (it === '' || it === null || it === undefined) ? '' : String(it);
    const full = String(vals[i][0]) + '|' + key;
    if (map[full] && dupOut) dupOut.push(map[full]);
    map[full] = { g: String(vals[i][2]), row: i + 1 };
  }
  return map;
}

function gtDue_(due) {
  if (!due) return undefined;
  // משימות גוגל שומרות תאריך בלבד, ותמיד ב-UTC בחצות.
  return String(due) + 'T00:00:00.000Z';
}

function syncGoogleTasks_() {
  const listId = gtListId_();
  const sh = gtMapTab_();
  const dups = [];
  const map = gtMapRead_(dups);
  const ours = listTasks_();
  const byId = {};
  ours.forEach(function (t) { byId[String(t.id)] = t; });

  const remote = Tasks.Tasks.list(listId, { showCompleted: true, showHidden: true, maxResults: 100 }) || {};
  const gById = {};
  (remote.items || []).forEach(function (g) { gById[g.id] = g; });

  const adds = [];      // שורות מיפוי חדשות
  const drops = [];     // שורות מיפוי למחיקה, מהסוף להתחלה
  dups.forEach(function (d) { try { Tasks.Tasks.remove(listId, d.g); } catch (e) {} drops.push(d.row); });
  let pulled = 0, pushed = 0;

  // משיכה: מה שסומן כבוצע בטלפון, בתוך משימות גוגל, נסגר גם אצלנו.
  Object.keys(map).forEach(function (key) {
    const parts = key.split('|');
    const t = byId[parts[0]];
    const g = gById[map[key].g];
    if (!t) { if (g) { try { Tasks.Tasks.remove(listId, g.id); } catch (e) {} } drops.push(map[key].row); return; }
    if (!g) { drops.push(map[key].row); return; }
    const doneThere = g.status === 'completed';
    if (parts[1] === '') {
      if (doneThere && !t.done) { updateTask_({ id: t.id, shared: t.shared, done: true }); pulled++; }
    } else {
      const i = Number(parts[1]);
      const item = (t.items || [])[i];
      if (item && doneThere && !item.d) { item.d = true; updateTask_({ id: t.id, shared: t.shared, items: t.items }); pulled++; }
    }
  });

  // דחיפה: כל מטלה פתוחה שאין לה עדיין משימת גוגל.
  ours.forEach(function (t) {
    if (t.done) return;
    const key = String(t.id) + '|';
    let parentId = map[key] && gById[map[key].g] ? map[key].g : null;
    if (!parentId) {
      const g = Tasks.Tasks.insert({ title: t.title, due: gtDue_(t.due), notes: t.shared ? 'משותף' : '' }, listId);
      parentId = g.id; adds.push([t.id, '', g.id]); pushed++;
    }
    (t.items || []).forEach(function (item, i) {
      const ik = String(t.id) + '|' + i;
      if (map[ik] && gById[map[ik].g]) return;
      const g = Tasks.Tasks.insert({ title: item.t }, listId, { parent: parentId });
      if (item.d) Tasks.Tasks.patch({ status: 'completed' }, listId, g.id);
      adds.push([t.id, String(i), g.id]); pushed++;
    });
  });

  // סגירה: מה שנסגר אצלנו נסגר גם שם.
  ours.forEach(function (t) {
    const key = String(t.id) + '|';
    const m = map[key]; if (!m) return;
    const g = gById[m.g]; if (!g) return;
    if (t.done && g.status !== 'completed') Tasks.Tasks.patch({ status: 'completed' }, listId, g.id);
    (t.items || []).forEach(function (item, i) {
      const mi = map[String(t.id) + '|' + i]; if (!mi) return;
      const gi = gById[mi.g]; if (!gi) return;
      if (item.d && gi.status !== 'completed') Tasks.Tasks.patch({ status: 'completed' }, listId, gi.id);
      if (!item.d && gi.status === 'completed') Tasks.Tasks.patch({ status: 'needsAction' }, listId, gi.id);
    });
  });

  drops.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
  if (adds.length) sh.getRange(sh.getLastRow() + 1, 1, adds.length, 3).setValues(adds);
  log_('syncTasks', 'נדחפו ' + pushed + ', נמשכו ' + pulled);
  return { ok: true, pushed: pushed, pulled: pulled, tasks: listTasks_() };
}

/* ---------- שיחה עם קלוד ---------- */
function model_() { return PROPS.getProperty('MODEL') || 'claude-sonnet-5'; }
function chat_(b) {
  const key = PROPS.getProperty('ANTHROPIC_API_KEY');
  if (!key) throw new Error('חסר מפתח: הגדירו ANTHROPIC_API_KEY במאפייני הסקריפט');
  const ctx = b.context || {};
  const fem = ctx.gender === 'f';
  const system = [
    'אתה עוזר אישי של ' + (ctx.me || 'המשתמש') + '. ' + (fem ? 'פנה אליה בלשון נקבה.' : 'פנה אליו בלשון זכר.') + ' ענה בעברית, קצר וישיר, בלי מילות ריצוד.',
    'זהו מכשיר של אחד משני בני זוג. לכל אחד עוזר משלו; מה שמסומן "משותף" נראה אצל שניהם.',
    'תגים = הילדים: ' + JSON.stringify(ctx.tags || []) + '. כשמוזכר ילד בשם או בכינוי, מלא tags עם שמו, והפריט משותף.',
    'לכל ילד יש age (גיל) ו-grade (כיתה). כשהודעה או תמונה מזכירה טווח גילים או כיתה — למשל הזמנה ליום הולדת לגילאי 5-7, '
    + 'חוג לכיתות א-ב, או פעילות לגיל 6 — שייך אותה לילד שגילו או כיתתו בטווח, גם אם שמו לא מופיע. ציין ב-why על סמך מה שייכת. '
    + 'אם יותר מילד אחד מתאים לטווח, אל תנחש: החזר את ההצעה בלי tags, וכתוב ב-why אילו ילדים מתאימים כדי שהמשתמש יבחר. '
    + 'אם אין ילד בטווח, אל תשייך לאף אחד.',
    'הזמן עכשיו: ' + (ctx.now || new Date().toISOString()) + ' (אזור זמן ' + (ctx.tz || TZ) + '). תאריכים יחסיים ("מחר", "ביום שלישי") מחושבים מהזמן הזה.',
    'אירועים בימים הקרובים (כולל משותפים): ' + JSON.stringify(ctx.events || []),
    'מטלות פתוחות (עם מי הוסיף): ' + JSON.stringify(ctx.tasks || []),
    'מגבלת המטלות המהותיות ליום: ' + (ctx.mitmax || 3) + '.',
    '',
    'כלל יסוד: אתה מציע, לא מבצע. כל פגישה, מטלה או מייל חוזרים כהצעה שמאושרת בלחיצה. מייל נשמר כטיוטה בלבד.',
    'פרטי או משותף: shared=true כשמדובר בילד, במשפחה, בבית, או כשנאמר במפורש "משותף", "לשנינו", "שבן או בת הזוג יראו". אחרת shared=false והפריט נשאר פרטי ביומן האישי. תמיד אפשר לשנות בכרטיס.',
    'תמונות והודעות מועברות: אם צורפה תמונה (צילום מסך של ווטסאפ, הזמנה, לוח חוגים, מכתב מבית הספר) או הודבק טקסט מועבר — חלץ ממנו את כל האירועים והמטלות, כל אחד כהצעה נפרדת עם תאריך ושעה מדויקים. אם השנה חסרה, הנח את המועד הקרוב הבא. ציין ב־why מאיפה נלקח כל פרט. אם משהו לא ברור בתמונה, שאל במקום לנחש.',
    'אירוע חוזר: כשנאמר "כל שבוע", "כל יום", "כל חודש", "קבוע" או "חוזר", מלא repeat={"freq":"daily|weekly|monthly","until":"YYYY-MM-DD"}. את until ממלאים רק אם נאמר עד מתי במפורש; אחרת until="" ואל תמציא תאריך. באירוע שאינו חוזר repeat=null.',
    'תזכורת מול מטלה: אם נאמר "ביומן", "תזכורת ביומן", "תקבע", או שנאמרה שעה ביום — החזר event, לא task. task הוא רק פריט ברשימה, בלי שעה. מטלה נכנסת לרשימת המטלות בלבד ולעולם לא ליומן גוגל, ולכן אסור לתאר task בתשובה כמשהו שנכנס "ליומן".',
    'כשיש התנגשות ביומן ציין זאת ב־why. הפרד בין חשוב לדחוף.',
    '',
    'החזר אך ורק אובייקט JSON תקין, בלי טקסט מסביב ובלי סימני קוד:',
    '{"reply":"טקסט קצר בעברית","proposals":[',
    ' {"type":"event","title":"...","start":"ISO עם אזור זמן","end":"ISO","location":"","tags":["שם ילד"],"shared":false,"repeat":null,"why":"..."},',
    ' {"type":"task","title":"...","tags":[],"shared":false,"importance":"high|normal","due":"YYYY-MM-DD","mit":false,"items":[],"why":"..."},',
    'מטלה עם רשימה: כשהבקשה מכילה כמה דברים לעשות תחת כותרת אחת — קניות, ציוד לטיול, הכנות לאירוע — החזר מטלה אחת עם items, מערך של מחרוזות קצרות, ולא מטלה נפרדת לכל פריט. מטלה רגילה מחזירה items ריק.',
    ' {"type":"email_draft","to":"","subject":"...","body":"...","why":"..."}',
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
    payload: JSON.stringify({ model: model_(), max_tokens: 8000, system: system, messages: messages }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode(); const data = JSON.parse(res.getContentText());
  if (code >= 300) throw new Error('שגיאת מנוע ' + code + ': ' + (data.error && data.error.message || res.getContentText()));
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  const truncated = data.stop_reason === 'max_tokens';
  const out = parseReply_(text);
  // תשובה ריקה אינה "טקסט שלא הצלחתי לקרוא" — היא כלום. אמירה מדויקת חוסכת
  // למשתמש לחפש טקסט שאינו קיים, ומכוונת אותו פשוט לשלוח שוב.
  if (!text) {
    out.warning = 'המנוע החזיר תשובה ריקה (' + (data.stop_reason || 'בלי סיבה') + '). שלחו שוב.';
  } else if (out.parseFailed) {
    out.warning = truncated
      ? 'התשובה נחתכה באמצע ולכן לא הצלחתי לקרוא ממנה הצעות. נסו לפצל — למשל תמונה אחת בכל פעם.'
      : 'קיבלתי תשובה שלא הצלחתי לקרוא כהצעות. הטקסט למטה, אבל אין ממנו כרטיסים לאישור.';
  } else if (truncated) {
    out.warning = 'התשובה נחתכה באמצע. ייתכן שחלק מההצעות חסרות.';
  }
  log_('chat', (b.message || '(תמונה)').slice(0, 120));
  return out;
}
// מנסה JSON נקי, אחר כך בלי גדר קוד, ואחר כך את האובייקט הראשון שבתוך הטקסט.
function parseReply_(text) {
  const fenced = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const tries = [text, fenced];
  const a = text.indexOf('{'), z = text.lastIndexOf('}');
  if (a >= 0 && z > a) tries.push(text.slice(a, z + 1));
  for (const t of tries) {
    try {
      const o = JSON.parse(t);
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return { reply: typeof o.reply === 'string' ? o.reply : text, proposals: Array.isArray(o.proposals) ? o.proposals : [] };
      }
    } catch (e) {}
  }
  return { reply: text, proposals: [], parseFailed: true };
}

/* ---------- תקציר ערב: לוז המחר, ערב קודם ---------- */
/*
 * ערוץ המסירה נקבע במאפיין DIGEST_CHANNEL:
 *   email (ברירת מחדל) — נשלח בדואר אל הכתובת של בעל הסקריפט עצמו, ואף פעם לא לאף אחד אחר.
 *                        ג'ימייל מצלצל בטלפון, ושום דבר לא נערם ביומן.
 *   notify             — אירוע קצר ביומן האישי, עם התקציר בתיאור ותזכורת קופצת. למי שרוצה
 *                        את התקציר בתוך היומן. יציאה מהערוץ הזה מוחקת את האירוע שנשאר.
 *   draft              — נשמר כטיוטה בג'ימייל. שומר על הכלל "לא שולחים מהקוד".
 *   off                — כבוי.
 *
 * בערוץ notify הטריגר רץ שעתיים לפני שעת ההתראה, כי טריגר זמן באפס סקריפט מדויק
 * רק לכדי שעה. השעתיים האלה הן מרווח הביטחון שהאירוע ייווצר לפני שהתזכורת אמורה לצלצל.
 * השעה נקבעת ב-DIGEST_HOUR. התקנת הטריגר: setDigest_ מהאפליקציה, או installDailyDigest() מהעורך.
 */
const DIGEST_FN = 'dailyDigest';

function digestConfig_() {
  const installed = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === DIGEST_FN);
  return {
    channel: PROPS.getProperty('DIGEST_CHANNEL') || 'email',
    hour: Number(PROPS.getProperty('DIGEST_HOUR') || 21),
    installed: installed,
    to: selfEmail_(),
    appUrl: PROPS.getProperty('APP_URL') || '',
  };
}
function selfEmail_() {
  return Session.getEffectiveUser().getEmail() || Session.getActiveUser().getEmail() || '';
}
function setDigest_(b) {
  const channel = ['notify', 'draft', 'email', 'off'].indexOf(b.channel) >= 0 ? b.channel : 'email';
  let hour = Number(b.hour); if (isNaN(hour) || hour < 0 || hour > 23) hour = 21;
  PROPS.setProperty('DIGEST_CHANNEL', channel);
  PROPS.setProperty('DIGEST_HOUR', String(hour));
  if (b.appUrl) PROPS.setProperty('APP_URL', String(b.appUrl));
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === DIGEST_FN) ScriptApp.deleteTrigger(t); });
  // בערוץ ההתראה מקדימים את הטריגר, כדי שהאירוע ייווצר לפני שהתזכורת צריכה לצלצל.
  if (channel !== 'off') {
    const runAt = channel === 'notify' ? (hour + 22) % 24 : hour;
    ScriptApp.newTrigger(DIGEST_FN).timeBased().atHour(runAt).everyDays(1).create();
  }
  if (channel !== 'notify') clearDigestEvent_();
  log_('setDigest', channel + ' @ ' + hour);
  return { ok: true, config: digestConfig_() };
}
// המופע הקרוב הבא של השעה הזאת: היום אם עוד לא עברה, אחרת מחר.
function nextAt_(hour) {
  const d = new Date(); d.setMinutes(0, 0, 0);
  if (d.getHours() >= hour) d.setDate(d.getDate() + 1);
  d.setHours(hour);
  return d;
}
function installDailyDigest() { Logger.log(JSON.stringify(setDigest_({ channel: PROPS.getProperty('DIGEST_CHANNEL') || 'draft', hour: PROPS.getProperty('DIGEST_HOUR') || 21 }))); }
function removeDailyDigest() { Logger.log(JSON.stringify(setDigest_({ channel: 'off' }))); }

function buildDigest_(ref) {
  const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const start = new Date(ref || new Date()); start.setDate(start.getDate() + 1); start.setHours(0, 0, 0, 0);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  const evs = [];
  visibleCalendars_().forEach(c => {
    const mine = c.isMyPrimaryCalendar();
    c.getEvents(start, end).forEach(ev => {
      if (ev.isAllDayEvent()) return;
      evs.push({ t: ev.getStartTime(), e: ev.getEndTime(), title: ev.getTitle(), loc: ev.getLocation() || '', cal: c.getName(), shared: !mine });
    });
  });
  evs.sort((a, b) => a.t - b.t);
  const hhmm = d => Utilities.formatDate(d, TZ, 'HH:mm');

  const lines = ['מחר, יום ' + HE_DAYS[start.getDay()] + ' ' + Utilities.formatDate(start, TZ, 'd.M') + '', ''];
  lines.push('הלוז:');
  if (!evs.length) lines.push('  אין אירועים ביומן. יום פתוח.');
  evs.forEach(e => lines.push('  ' + hhmm(e.t) + '–' + hhmm(e.e) + '  ' + e.title +
    (e.loc ? ' · ' + e.loc : '') + (e.shared ? ' · ' + e.cal : '')));

  let tasks = [];
  try { tasks = listTasks_().filter(t => !t.done); } catch (err) { tasks = []; }
  const mits = tasks.filter(t => t.mit);
  const overdue = tasks.filter(t => !t.mit && t.due && t.due < Utilities.formatDate(start, TZ, 'yyyy-MM-dd'));
  const shared = tasks.filter(t => !t.mit && t.shared);

  lines.push('', 'מטלות מהותיות שנבחרו:');
  if (!mits.length) lines.push('  עוד לא נבחרו. זה הרגע לבחור עד שלוש.');
  mits.forEach(t => lines.push('  · ' + t.title + (t.shared ? ' (משותף)' : '')));

  if (overdue.length) {
    lines.push('', 'עברו את התאריך:');
    overdue.slice(0, 10).forEach(t => lines.push('  · ' + t.title + ' — היה עד ' + t.due));
  }
  if (shared.length) {
    lines.push('', 'פתוח ברשימה המשותפת:');
    shared.slice(0, 10).forEach(t => lines.push('  · ' + t.title + (t.author ? ' — ' + t.author : '')));
  }
  lines.push('', 'לפני שסוגרים את היום: מה נסגר, ואיפה עצרת בכל כובע?');
  return lines.join('\n');
}

// תצוגה מקדימה, ואפשרות לירות התראת ניסיון כדי לראות אותה בטלפון עכשיו.
function digest_(b) {
  const out = { text: buildDigest_(), config: digestConfig_() };
  if (b && b.fire) {
    // ניסיון = עכשיו, לא בשעה שהוגדרה. אחרת הכפתור מבטיח דבר אחד ועושה אחר.
    if (out.config.channel === 'notify') {
      const at = new Date(Date.now() + 2 * 60000); at.setSeconds(0, 0);
      postDigestEvent_(at);
      out.firedAt = Utilities.formatDate(at, TZ, 'HH:mm');
    } else {
      dailyDigest();
    }
    out.fired = true;
  }
  return out;
}
const DIGEST_TITLE = 'הלוז של מחר';

// ערוץ ההתראה: אירוע קצר ביומן האישי, התקציר בתיאור, תזכורת קופצת ברגע האירוע.
// זו הדרך היחידה להשיג צלצול בטלפון בשעה מדויקת בלי תשתית פוש.
function postDigestEvent_(at) {
  const cal = CalendarApp.getDefaultCalendar();
  const end = new Date(at.getTime() + 15 * 60000);
  // מוחקים רק את האירוע שאנחנו יצרנו, לפי מזהה שנשמר — אף פעם לא לפי כותרת.
  // מחיקה לפי שם הייתה מוחקת גם אירוע אמיתי של המשתמש שבמקרה נקרא כך.
  const prev = PROPS.getProperty('DIGEST_EVENT_ID');
  if (prev) {
    try { const old = cal.getEventById(prev); if (old) old.deleteEvent(); } catch (e) {}
    PROPS.deleteProperty('DIGEST_EVENT_ID');
  }

  const url = PROPS.getProperty('APP_URL') || '';
  const link = url ? ['',
    'לפתיחה בעוזר, עם העתקה ושיתוף:',
    url + '?digest=1'].join('\n') : '';
  const body = buildDigest_(at) + link;
  const ev = cal.createEvent(DIGEST_TITLE, at, end, { description: body });
  ev.removeAllReminders();
  ev.addPopupReminder(0);
  PROPS.setProperty('DIGEST_EVENT_ID', ev.getId());
  log_('digest', 'נוצרה התראה ביומן ל־' + Utilities.formatDate(at, TZ, 'dd/MM HH:mm'), ev.getId(), cal.getId());
  return ev.getId();
}

// מוחקים רק את האירוע שאנחנו יצרנו, לפי המזהה השמור.
function clearDigestEvent_() {
  const prev = PROPS.getProperty('DIGEST_EVENT_ID');
  if (!prev) return;
  try { const old = CalendarApp.getDefaultCalendar().getEventById(prev); if (old) old.deleteEvent(); } catch (e) {}
  PROPS.deleteProperty('DIGEST_EVENT_ID');
  log_('digest', 'האירוע ביומן הוסר');
}

function dailyDigest() {
  const cfg = digestConfig_();
  if (cfg.channel === 'off') return;
  if (cfg.channel === 'notify') { postDigestEvent_(nextAt_(cfg.hour)); return; }
  const body = buildDigest_();
  const subject = 'העוזר — הלוז של מחר';
  const to = selfEmail_();
  if (!to) { log_('digest', 'אין כתובת דואר לבעל הסקריפט'); return; }
  if (cfg.channel === 'email') {
    // רק אל עצמך. הכתובת נלקחת מהחשבון ולא מגוף הבקשה, כדי שלא ניתן יהיה לשלוח לאף אחד אחר.
    MailApp.sendEmail(to, subject, body);
    log_('digest', 'נשלח תקציר אל ' + to);
  } else {
    GmailApp.createDraft(to, subject, body);
    log_('digest', 'נשמרה טיוטת תקציר');
  }
}

/* ---------- הגדרה חד־פעמית ---------- */
function setup() {
  CalendarApp.getAllCalendars().length;
  privateSheet_();
  GmailApp.getDrafts();
  if (!PROPS.getProperty('APP_SECRET')) PROPS.setProperty('APP_SECRET', Utilities.getUuid());
  Logger.log('APP_SECRET = ' + PROPS.getProperty('APP_SECRET') + ' — להעתיק לשדה "סוד" בהגדרות האפליקציה, בכל מכשיר. בלעדיו כל מי שמכיר את הכתובת יכול לקרוא ולכתוב.');
  Logger.log('מוכן. גיליון פרטי: ' + PROPS.getProperty('SHEET_ID') + ' | גיליון משותף: ' + (PROPS.getProperty('SHARED_SHEET_ID') || 'לא מוגדר'));
}
// מריצים פעם אחת, בחשבון אחד בלבד. את המזהה שמודפס מכניסים ל־SHARED_SHEET_ID בשני החשבונות.
function createSharedSheet() {
  const ss = SpreadsheetApp.create('העוזר — מטלות (משותף)');
  ss.getActiveSheet().setName('מטלות').appendRow(TASK_HEADER);
  PROPS.setProperty('SHARED_SHEET_ID', ss.getId());
  Logger.log('SHARED_SHEET_ID = ' + ss.getId() + '\nכתובת: ' + ss.getUrl() + '\nעכשיו לשתף את הגיליון (עריכה) עם החשבון השני, ולהכניס את המזהה גם אצלו.');
}
