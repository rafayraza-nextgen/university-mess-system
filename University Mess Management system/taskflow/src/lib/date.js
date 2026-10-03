// Date helpers for `date`-only Postgres columns.
//
// A Postgres `date` has no timezone, so it must never be converted through UTC.
// Every helper here reads and writes the user's *local* calendar day, which
// keeps meal rollovers aligned with midnight in the mess's own timezone.

const pad = (value) => String(value).padStart(2, "0");

// "YYYY-MM-DD" for the local calendar day of the given date.
export const getLocalDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

// Parses "YYYY-MM-DD" at local midnight. The explicit T00:00:00 stops the
// browser from treating the value as UTC and shifting the day.
export const parseDateKey = (dateKey) => {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
};

export const formatDateKey = (dateKey, options) =>
  new Intl.DateTimeFormat("en-US", options).format(parseDateKey(dateKey));

// Moves a date key by whole days using local arithmetic, so DST shifts and
// positive UTC offsets cannot roll the result into an adjacent day.
export const shiftDateKey = (dateKey, offsetDays) => {
  const shifted = parseDateKey(dateKey);
  shifted.setDate(shifted.getDate() + offsetDays);
  return getLocalDateKey(shifted);
};

export const getUpcomingDayLabel = (dateKey, todayKey) => {
  if (dateKey === todayKey) return "Today";
  if (dateKey === shiftDateKey(todayKey, 1)) return "Tomorrow";
  return formatDateKey(dateKey, { weekday: "long" });
};

export const getPastDayLabel = (dateKey, todayKey) => {
  if (dateKey === todayKey) return "Today";
  if (dateKey === shiftDateKey(todayKey, -1)) return "Yesterday";
  return formatDateKey(dateKey, { weekday: "long" });
};

// "HH:MM:SS" for the local wall clock, in the shape a Postgres `time` column
// expects. Built from the parts rather than toTimeString(), whose output format
// is implementation defined.
export const getLocalTimeString = (date = new Date()) => {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${hours}:${minutes}:${seconds}`;
};

// Milliseconds until the next local midnight, used to refetch menus the
// instant a new day starts instead of leaving yesterday's meals on screen.
export const getMillisecondsUntilNextMidnight = (now = new Date()) => {
  const nextMidnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    0,
    0,
    0,
    0,
  );

  return nextMidnight.getTime() - now.getTime();
};
