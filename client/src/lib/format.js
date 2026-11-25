const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

const sameDay = (a, b) => a.toDateString() === b.toDateString();

/** "Sat, Dec 6, 2026, 6:00 PM - 9:00 PM" or a two-date range when it spans days. */
export function formatRange(startIso, endIso) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (sameDay(start, end)) {
    return `${dateFmt.format(start)}, ${timeFmt.format(start)} - ${timeFmt.format(end)}`;
  }
  return `${dateFmt.format(start)}, ${timeFmt.format(start)} - ${dateFmt.format(end)}, ${timeFmt.format(end)}`;
}

export const formatCost = (cost) => (cost === 0 ? 'Free' : money.format(cost));

export const hasEnded = (event) => new Date(event.end).getTime() <= Date.now();

/** ISO string to the value a <input type="datetime-local"> expects (local time). */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (local time) to a UTC ISO string for the API. */
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : '');

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

export const roleLabel = { user: 'Member', planner: 'Event Planner', admin: 'Admin', visitor: 'Visitor' };
