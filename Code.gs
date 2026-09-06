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
const TASK_HEADER = ['מזהה', 'כותרת', 'כובע', 'תגים', 'חשיבות', 'תאריך יעד', 'מהותית', 'בוצע', 'מי הוסיף', 'נוצר'];
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
      case 'ping':           return json_({ ok: true, calendars: calendars_(), model: model_(), sharedSheet: !!PROPS.getProperty('SHARED_SHEET_ID'), secured: !!secret, digest: digestConfig_() });
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
  // התראות: קופצות באפליקציית יומן גוגל בטלפון. זה ערוץ ההתראות היחיד שלא דורש תשתית נוספת.
  applyReminders_(ev, b.reminders);
  log_('createEvent', cal.getName() + ' | ' + b.title + ' ' + b.start, ev.getId(), cal.getId());
  return { ok: true, id: ev.getId(), calendarId: cal.getId() };
}
function applyReminders_(ev, mins) {
  const list = Array.isArray(mins) ? mins : [];
  if (!list.length) return;
  ev.removeAllReminders();
  // גוגל מקבל עד חמש תזכורות, וכל אחת עד ארבעה שבועות מראש.
  list.map(Number).filter(m => !isNaN(m) && m >= 0 && m <= 40320).slice(0, 5)
      .forEach(m => ev.addPopupReminder(m));
}
function deleteEvent_(id, calendarId) {
  const cals = calendarId ? [calById_(calendarId)] : visibleCalendars_();
  for (const c of cals) { const ev = c.getEventById(id); if (ev) { const t = ev.getTitle(); ev.deleteEvent(); log_('deleteEvent', t, id, c.getId()); return { ok: true }; } }
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
    done: fmtDone_(r[7]), author: r[8] || '', shared: shared };
}
// done הוא תמיד מחרוזת: '' כשפתוח, אחרת 'yyyy-MM-dd'. גיליונות ישנים החזיקו גם TRUE.
function fmtDone_(v) {
  if (!v) return '';
  if (v === true || v === 'TRUE' || v === 'yes') return fmtDate_(new Date());
  return fmtDate_(v);
}
function fmtDate_(v) { return v instanceof Date ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd') : String(v); }
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
  if ('done' in b) f.sh.getRange(f.row, 8).setValue(b.done ? (typeof b.done === 'string' ? b.done : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) : '');
  if ('title' in b) f.sh.getRange(f.row, 2).setValue(b.title);
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
    'הכובעים (הקשרים) של ' + (ctx.me || '') + ': ' + JSON.stringify(ctx.hats || []) + '. היום הוא יום ' + (ctx.dayHat || 'ללא כובע') + '.',
    'תגים = הילדים: ' + JSON.stringify(ctx.tags || []) + '. כשמוזכר ילד בשם או בכינוי, מלא tags עם שמו; כשיש תג, הכובע הוא family והפריט משותף.',
    'הזמן עכשיו: ' + (ctx.now || new Date().toISOString()) + ' (אזור זמן ' + (ctx.tz || TZ) + '). תאריכים יחסיים ("מחר", "ביום שלישי") מחושבים מהזמן הזה.',
    'אירועים בימים הקרובים (כולל משותפים): ' + JSON.stringify(ctx.events || []),
    'מטלות פתוחות (עם מי הוסיף): ' + JSON.stringify(ctx.tasks || []),
    'מגבלת המטלות המהותיות ליום: ' + (ctx.mitmax || 3) + '.',
    '',
    'כלל יסוד: אתה מציע, לא מבצע. כל פגישה, מטלה או מייל חוזרים כהצעה שמאושרת בלחיצה. מייל נשמר כטיוטה בלבד.',
    'פרטי או משותף: shared=true כשמדובר בילד, במשפחה, בבית, או כשנאמר במפורש "משותף", "לשנינו", "שבן או בת הזוג יראו". אחרת shared=false והפריט נשאר פרטי ביומן האישי. תמיד אפשר לשנות בכרטיס.',
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
    payload: JSON.stringify({ model: model_(), max_tokens: 8000, system: system, messages: messages }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode(); const data = JSON.parse(res.getContentText());
  if (code >= 300) throw new Error('שגיאת מנוע ' + code + ': ' + (data.error && data.error.message || res.getContentText()));
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
  const truncated = data.stop_reason === 'max_tokens';
  const out = parseReply_(text);
  // כשהפענוח נכשל ההצעות נעלמו קודם בשקט. עכשיו אומרים את זה במפורש.
  if (out.parseFailed) {
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
 *   notify (מומלץ)     — אירוע קצר ביומן האישי בשעה שנבחרה, עם התקציר בתיאור ותזכורת קופצת.
 *                        יומן גוגל מצלצל בטלפון, לחיצה פותחת את הטקסט, ומשם העתקה ושיתוף.
 *   draft              — נשמר כטיוטה בג'ימייל. שומר על הכלל "לא שולחים מהקוד".
 *   email              — נשלח בדואר אל הכתובת של בעל הסקריפט עצמו, ואף פעם לא לאף אחד אחר.
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
    channel: PROPS.getProperty('DIGEST_CHANNEL') || 'notify',
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
  const channel = ['notify', 'draft', 'email', 'off'].indexOf(b.channel) >= 0 ? b.channel : 'notify';
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
  if (b && b.fire) { dailyDigest(); out.fired = true; }
  return out;
}
const DIGEST_TITLE = 'הלוז של מחר';

// ערוץ ההתראה: אירוע קצר ביומן האישי, התקציר בתיאור, תזכורת קופצת ברגע האירוע.
// זו הדרך היחידה להשיג צלצול בטלפון בשעה מדויקת בלי תשתית פוש.
function postDigestEvent_(hour) {
  const cal = CalendarApp.getDefaultCalendar();
  const at = nextAt_(hour);
  const end = new Date(at.getTime() + 15 * 60000);
  // מנקים אירוע קודם של אותו יום, כדי שלא יצטברו כפילויות
  const dayStart = new Date(at); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  cal.getEvents(dayStart, dayEnd).forEach(ev => { if (ev.getTitle() === DIGEST_TITLE) ev.deleteEvent(); });

  const url = PROPS.getProperty('APP_URL') || '';
  const link = url ? ['',
    'לפתיחה בעוזר, עם העתקה ושיתוף:',
    url + '?digest=1'].join('\n') : '';
  const body = buildDigest_(at) + link;
  const ev = cal.createEvent(DIGEST_TITLE, at, end, { description: body });
  ev.removeAllReminders();
  ev.addPopupReminder(0);
  log_('digest', 'נוצרה התראה ביומן ל־' + Utilities.formatDate(at, TZ, 'dd/MM HH:mm'), ev.getId(), cal.getId());
  return ev.getId();
}

function dailyDigest() {
  const cfg = digestConfig_();
  if (cfg.channel === 'off') return;
  if (cfg.channel === 'notify') { postDigestEvent_(cfg.hour); return; }
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
