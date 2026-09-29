// Zimbabwe public holidays — Public Holidays and Prohibition of Business Act
// (Chapter 10:21) and amendments.
//
//   Fixed:      New Year's Day (1 Jan), National Youth Day (21 Feb),
//               Independence Day (18 Apr), Workers' Day (1 May),
//               Africa Day (25 May), Munhumutapa Day (15 Sep),
//               Unity Day (22 Dec), Christmas Day (25 Dec), Boxing Day (26 Dec)
//   Movable:    Good Friday, Holy Saturday, Easter Sunday*, Easter Monday
//               (* Easter Sunday itself falls on a weekend day; listed for
//                  completeness of the Easter cluster.)
//   Week-based: Heroes' Day (2nd Monday of Aug), Defence Forces Day
//               (2nd Tuesday of Aug)
//
// All helpers work on UTC-midnight day values, matching the system-wide
// convention that an attendance "day" is new Date('YYYY-MM-DDT00:00:00.000Z').

// Anonymous Gregorian algorithm — returns Easter Sunday as UTC midnight.
const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

const addDays = (date, n) => new Date(date.getTime() + n * 86400000);

// Nth weekday of a month, e.g. nthWeekdayOfMonth(2026, 7, 1, 2) = 2nd Monday of Aug.
// (month is 0-indexed; weekday: 0=Sun..6=Sat)
const nthWeekdayOfMonth = (year, month, weekday, n) => {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month, 1 + offset + (n - 1) * 7));
};

const fixed = (year, month, day) => new Date(Date.UTC(year, month, day));

// All public holidays for a year as [{ date: Date, name: String }], sorted by date.
const zimbabweHolidays = (year) => {
  const easter = easterSunday(year);
  return [
    { date: fixed(year, 0, 1), name: "New Year's Day" },
    { date: fixed(year, 1, 21), name: 'National Youth Day' },
    { date: addDays(easter, -2), name: 'Good Friday' },
    { date: addDays(easter, -1), name: 'Holy Saturday' },
    { date: easter, name: 'Easter Sunday' },
    { date: addDays(easter, 1), name: 'Easter Monday' },
    { date: fixed(year, 3, 18), name: 'Independence Day' },
    { date: fixed(year, 4, 1), name: "Workers' Day" },
    { date: fixed(year, 4, 25), name: 'Africa Day' },
    { date: nthWeekdayOfMonth(year, 7, 1, 2), name: "Heroes' Day" },
    { date: nthWeekdayOfMonth(year, 7, 2, 2), name: 'Defence Forces Day' },
    { date: fixed(year, 8, 15), name: 'Munhumutapa Day' },
    { date: fixed(year, 11, 22), name: 'National Unity Day' },
    { date: fixed(year, 11, 25), name: 'Christmas Day' },
    { date: fixed(year, 11, 26), name: 'Boxing Day' }
  ].sort((a, b) => a.date - b.date);
};

const cache = new Map();
const holidaysForYear = (year) => {
  if (!cache.has(year)) cache.set(year, zimbabweHolidays(year));
  return cache.get(year);
};

// Normalise any Date to its UTC-midnight day key, e.g. '2026-12-25'.
const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

// Returns the holiday name if the given day (UTC midnight or any instant that
// UTC-date-matches) is a Zimbabwe public holiday, otherwise null.
const holidayName = (date) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const key = dayKey(d);
  const hit = holidaysForYear(d.getUTCFullYear()).find(h => dayKey(h.date) === key);
  return hit ? hit.name : null;
};

// Convenience: true/false. Accepts the same inputs as holidayName.
const isPublicHoliday = (date) => holidayName(date) !== null;

// { isHoliday, name } for a given day — used by routes and cron.
const holidayInfo = (date) => {
  const name = holidayName(date);
  return { isHoliday: name !== null, name };
};

// All holidays within [start, end] (inclusive, UTC days) as
// [{ date: Date, name: String }] sorted by date. Years covered by the
// range are generated on demand, so long ranges work too.
const holidaysInRange = (start, end) => {
  const s = new Date(start); const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s > e) return [];
  const out = [];
  for (let y = s.getUTCFullYear(); y <= e.getUTCFullYear(); y++) {
    for (const h of holidaysForYear(y)) {
      if (h.date >= s && h.date <= e) out.push(h);
    }
  }
  return out;
};

// Next `limit` holidays from a given day (defaults to today, UTC), inclusive.
// Weekend-only skipper: holidays that land on Sat/Sun stay listed — whether
// Zimbabwe declares a substitute day off varies by notice, so the UI shows
// them with their actual weekday and lets humans decide.
const upcomingHolidays = (from = new Date(), limit = 5) => {
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 400 * 86400000); // >13 months of horizon
  return holidaysInRange(start, end).slice(0, Math.max(1, limit));
};

// Working days in a month: Mon–Fri (UTC days) MINUS public holidays.
// Holidays falling on a weekend don't reduce the count (they were never
// working days). Returns { total, weekdays, holidays, workingDays,
// holidayList: [{ date, name }] }.
const workingDaysInMonth = (year, month) => {
  // month is 1-indexed here (API surface); internal Date months are 0-indexed.
  const first = new Date(Date.UTC(year, month - 1, 1));
  if (Number.isNaN(first.getTime()) || month < 1 || month > 12) {
    return { total: 0, weekdays: 0, holidays: 0, workingDays: 0, holidayList: [] };
  }
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of next month = last day
  const weekdayCount = (from, to) => {
    let n = 0;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86400000)) {
      const wd = d.getUTCDay();
      if (wd !== 0 && wd !== 6) n++;
    }
    return n;
  };
  const holidayList = holidaysInRange(first, last);
  const weekdays = weekdayCount(first, last);
  const onWeekday = holidayList.filter(h => h.date.getUTCDay() !== 0 && h.date.getUTCDay() !== 6).length;
  return { total: last.getUTCDate(), weekdays, holidays: holidayList.length, workingDays: weekdays - onWeekday, holidayList };
};

module.exports = { zimbabweHolidays, holidayName, isPublicHoliday, holidayInfo, easterSunday, holidaysInRange, upcomingHolidays, workingDaysInMonth };
