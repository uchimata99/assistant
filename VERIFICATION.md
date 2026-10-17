# אימות האפליקציה מול גוגל

המסמך הזה נועד להעתקה אל טופס האימות. ההסברים כתובים באנגלית כי בודקי גוגל קוראים אנגלית; מעל כל אחד יש שורה בעברית שאומרת מה הוא אומר.

התהליך נעשה **פעמיים**, פעם בכל פרויקט ענן, עם אותו תוכן בדיוק.

---

## לפני הכול: אימות בעלות על הדומיין

גוגל לא תאשר דומיין שלא הוכחה עליו בעלות. הדומיין שלנו הוא `uchimata99.github.io`, והוא בשליטתנו דרך המאגר.

1. להיכנס ל־Google Search Console ולהוסיף נכס מסוג **URL prefix** עם הכתובת `https://uchimata99.github.io/assistant/`.
2. לבחור אימות בשיטת **HTML tag**, ולהעתיק את תג המטא שמוצג.
3. לתת לי אותו. אני מוסיף אותו לכל עמודי האתר ודוחף, ותוך דקה הוא חי.
4. לחזור ללחוץ "אמת".

בלי השלב הזה שאר הטופס לא יתקדם.

---

## שדות הטופס

| שדה | מה למלא |
|---|---|
| App name | `העוזר` |
| App home page | `https://uchimata99.github.io/assistant/about.html` |
| Privacy policy | `https://uchimata99.github.io/assistant/privacy.html` |
| Terms of service | `https://uchimata99.github.io/assistant/terms.html` |
| Authorized domain | `uchimata99.github.io` |

---

## הסברים להרשאות

גוגל שואלת על כל הרשאה רגישה בנפרד: למה האפליקציה צריכה אותה, ומה היא עושה עם המידע. שלוש נקודות חוזרות בכל התשובות, והן מה שבודק רוצה לראות: מה הפעולה, למה אי אפשר בלעדיה, ולמה היא מצומצמת.

### תיאור כללי של האפליקציה

> בעברית: אפליקציה פרטית לניהול יומן ומטלות של משק בית אחד. אין שרת מרכזי, כל משתמש מריץ עותק בחשבון שלו, והנתונים נשארים אצלו.

```
"העוזר" (The Assistant) is a private household assistant used by two family members.
It turns free-text or spoken requests in Hebrew into proposed calendar events and
tasks, which the user reviews and approves before anything is written.

There is no central server and no shared database. Each user deploys their own copy
of the Apps Script project inside their own Google account, and all data stays in
that account. We do not collect, store, transmit or have access to any user data.
The app has no analytics, no advertising and no third parties beyond the user's own
Google account and the language model that interprets the request text.
```

### Google Calendar

> בעברית: קריאת הלוז כדי להציג אותו ולזהות התנגשויות, ויצירה או מחיקה של אירועים רק אחרי אישור מפורש.

```
The core purpose of the app is managing the household calendar.

Read: the app displays today's and the coming week's schedule, shows the free gaps
between events, and warns the user when a newly proposed event overlaps an existing
one. It also needs the event IDs so the user can say "add a reminder to the school
meeting" or "cancel Thursday's practice" and have the app identify the right event.

Write: the app creates an event only after the user explicitly approves a proposal
card on screen. It can also delete an event or change its reminders, again only on
explicit approval.

A narrower read-only scope is not sufficient, because creating and cancelling events
on approval is the main function of the app.
```

### Google Sheets

> בעברית: הגיליונות הם מסד הנתונים של המטלות, אחד פרטי ואחד משותף בין שני בני הבית.

```
The app stores its data in the user's own Google Sheets rather than in any database
we control. Two spreadsheets are used: a private one for personal tasks and the
action log, and a shared one that both household members can read and write, which
is how shared tasks, a small personal glossary and date-bound notes are synchronised
between the two accounts.

The app reads and writes only these spreadsheets, which it creates itself or which
the user explicitly configures by ID. This scope is required because the shared
spreadsheet is created by one account and opened by the other, so a per-file scope
cannot cover it.
```

### Google Tasks

> בעברית: שיקוף המטלות אל רשימת המשימות של גוגל, כדי שיופיעו גם באפליקציות של המכשיר.

```
Tasks created in the app are mirrored into a dedicated Google Tasks list named
"העוזר" in the user's own account, so that they also appear in the Google Tasks and
Google Calendar apps on the user's phone. Completing a task in either place is
reflected back.

The app reads and writes only the list it creates. It needs write access because
mirroring and two-way completion are the point of the feature.
```

### Send email as the user (`script.send_mail`)

> בעברית: תקציר ערב אחד ביום, אל הכתובת של בעל החשבון עצמו בלבד, וכשהוא בחר בכך.

```
The app can send one message per day: an evening summary of tomorrow's schedule and
the open tasks.

This message is sent only to the account owner's own address, which is read from the
authenticated account and never taken from the request body, so it is not technically
possible to send to anyone else. It is sent only when the user explicitly chooses the
email channel in settings; the default channel is a calendar event instead.

The app never sends email to third parties and has no mailing, marketing or
notification function.
```

### Run when the user is not present (`script.scriptapp`)

> בעברית: טריגר יומי אחד שמייצר את תקציר הערב.

```
The app installs a single daily time-based trigger, which produces the evening
summary described above at the hour the user chose. Without this scope the summary
cannot be produced while the user's phone is closed, which is the entire point of
an evening summary.

No other background activity exists, and the trigger is removed when the user turns
the summary off.
```

### Drive file access (`drive.file`)

> בעברית: יצירת הגיליונות ושיתוף הגיליון המשותף. ההרשאה המצומצמת, לא דרייב מלא.

```
The app creates its own spreadsheets during one-time setup and shares the shared
spreadsheet with the second household member.

This is the narrow per-file scope, which grants access only to files the app itself
created. The app previously requested full Drive access and that scope was
deliberately removed in favour of this one.
```

---

## סרטון ההדגמה

גוגל דורשת סרטון ביוטיוב. הוא יכול להיות לא מפורסם. דקה עד שתיים מספיקה, ואפשר להקליט מסך מהטלפון.

הבודק רוצה לראות שלושה דברים, ולפי הסדר:

1. **מסך ההסכמה עצמו**, עם שם האפליקציה והכתובת גלויים, ורשימת ההרשאות שמבוקשות.
2. **כל הרשאה רגישה בפעולה.** לפתוח את מסך היום כדי להראות קריאה מהיומן. לבקש פגישה בשיחה, להראות את כרטיס ההצעה, לאשר, ולהראות שהאירוע נכנס ליומן. להוסיף מטלה ולהראות שהיא מופיעה. להראות בהגדרות את בחירת ערוץ התקציר.
3. **שהאפליקציה היא שלך**, כלומר שהכתובת בסרגל הדפדפן היא הדומיין שאימתנו.

אפשר לדבר בעברית או בלי קול כלל. אם מדברים, שווה לומר באנגלית משפט אחד לכל מסך.

---

## מה צפוי אחר כך

גוגל עונה בדרך כלל תוך כמה ימים עד שבועות. עד האישור, הפקיעה של שבעה ימים ממשיכה, ולכן צריך להמשיך להריץ `setup` בשני החשבונות כשהשרת נופל.

אחרי האישור: אין יותר פקיעה, ואין יותר מסך "לא אומתה על ידי גוגל".
