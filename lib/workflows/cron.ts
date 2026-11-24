// Minimal 5-field cron parser/scheduler helper.
// Pure module (no server-only) so both the scheduler tick route and the
// client-side workflow detail page can use it.

export interface CronFields {
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
}

interface FieldSpec {
  min: number;
  max: number;
  wrapSunday?: boolean;
}

const FIELD_SPECS: FieldSpec[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6, wrapSunday: true },
];

const DOW_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseNumber(raw: string, spec: FieldSpec): number | null {
  if (!/^\d+$/.test(raw)) return null;
  let value = Number(raw);
  if (spec.wrapSunday && value === 7) value = 0;
  if (value < spec.min || value > spec.max) return null;
  return value;
}

function parseField(field: string, spec: FieldSpec): number[] | null {
  if (field === "*") {
    const all: number[] = [];
    for (let i = spec.min; i <= spec.max; i += 1) all.push(i);
    return all;
  }

  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "") return null;

    const [rangePart, stepPart, extra] = part.split("/");
    if (extra !== undefined) return null;

    let step = 1;
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) return null;
      step = Number(stepPart);
      if (step < 1) return null;
    }

    let start: number;
    let end: number;

    if (rangePart === "*") {
      start = spec.min;
      end = spec.max;
    } else if (rangePart.includes("-")) {
      const bounds = rangePart.split("-");
      if (bounds.length !== 2) return null;
      const parsedStart = parseNumber(bounds[0], spec);
      const parsedEnd = parseNumber(bounds[1], spec);
      if (parsedStart === null || parsedEnd === null) return null;
      start = parsedStart;
      end = parsedEnd;
    } else {
      const parsed = parseNumber(rangePart, spec);
      if (parsed === null) return null;
      start = parsed;
      // "n/step" means "from n to max, every step".
      end = stepPart !== undefined ? (spec.wrapSunday ? spec.max : spec.max) : parsed;
    }

    if (start > end) return null;
    for (let i = start; i <= end; i += step) values.add(i);
  }

  return [...values].sort((a, b) => a - b);
}

export function parseCron(cron: string): CronFields | null {
  if (typeof cron !== "string") return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const parsed = parts.map((part, i) => parseField(part, FIELD_SPECS[i]));
  if (parsed.some((p) => p === null)) return null;

  const [minutes, hours, daysOfMonth, months, daysOfWeek] = parsed as number[][];
  if (
    minutes.length === 0 ||
    hours.length === 0 ||
    daysOfMonth.length === 0 ||
    months.length === 0 ||
    daysOfWeek.length === 0
  ) {
    return null;
  }

  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

const MAX_SCAN_MINUTES = 366 * 24 * 60;

export function nextRunAt(cron: string, from: Date): Date | null {
  const fields = parseCron(cron);
  if (!fields) return null;

  const candidate = new Date(from.getTime());
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  for (let i = 0; i < MAX_SCAN_MINUTES; i += 1) {
    if (
      fields.minutes.includes(candidate.getMinutes()) &&
      fields.hours.includes(candidate.getHours()) &&
      fields.daysOfMonth.includes(candidate.getDate()) &&
      fields.months.includes(candidate.getMonth() + 1) &&
      fields.daysOfWeek.includes(candidate.getDay())
    ) {
      return candidate;
    }
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  return null;
}

function isFullRange(values: number[], min: number, max: number): boolean {
  if (values.length !== max - min + 1) return false;
  for (let i = min; i <= max; i += 1) {
    if (!values.includes(i)) return false;
  }
  return true;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function describeCron(cron: string): string {
  const fields = parseCron(cron);
  if (!fields) return cron;

  const { minutes, hours, daysOfMonth, months, daysOfWeek } = fields;
  const everyDay = isFullRange(daysOfMonth, 1, 31);
  const everyMonth = isFullRange(months, 1, 12);
  const everyDow = isFullRange(daysOfWeek, 0, 6);

  if (minutes.length === 1 && hours.length === 1) {
    const time = `${pad(hours[0])}:${pad(minutes[0])}`;
    if (everyDay && everyMonth && everyDow) return `Daily at ${time}`;
    if (everyDay && everyMonth && daysOfWeek.length === 1) {
      return `Weekly on ${DOW_LABELS[daysOfWeek[0]]} at ${time}`;
    }
  }

  return `Custom (${cron})`;
}
