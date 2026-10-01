import { addDays, endOfWeek, format } from 'date-fns';
import { createId, type Assignment, type Data, type Shift } from './model';

const isoDay = (date: Date) => format(date, 'yyyy-MM-dd');

export const duplicateShiftMessage = 'Este turno ya está asignado a este trabajador para este día.';

export type Summary = { days: number; hours: number; total: number; averageHours: number; shifts: number };

/**
 * The single place where money is decided. An assignment's payment is the shift's configured amount
 * at the moment it is created (or its shift is explicitly changed). Hours never affect payment.
 */
export const paymentService = {
  snapshot: (shift: Shift, hours: number): Pick<Assignment, 'shiftId' | 'shiftNameSnapshot' | 'hours' | 'paymentSnapshot'> => ({
    shiftId: shift.id,
    shiftNameSnapshot: shift.name,
    hours,
    paymentSnapshot: shift.paymentAmount,
  }),
  total: (assignments: Assignment[]) => Math.round(assignments.reduce((sum, item) => sum + item.paymentSnapshot, 0) * 100) / 100,
  hours: (assignments: Assignment[]) => assignments.reduce((sum, item) => sum + item.hours, 0),
  summarize: (assignments: Assignment[]): Summary => {
    const days = new Set(assignments.map((item) => item.date)).size;
    const hours = paymentService.hours(assignments);
    return { days, hours, total: paymentService.total(assignments), averageHours: days ? hours / days : 0, shifts: assignments.length };
  },
  money: (value: number) => `${value.toLocaleString('es-ES', { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 })} €`,
};

export const formatHours = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 2 })} h`;

export const hasShift = (data: Data, workerId: string, date: string, shiftId: string, ignoreId?: string) =>
  data.assignments.some((item) => item.workerId === workerId && item.date === date && item.shiftId === shiftId && item.id !== ignoreId);

export type NewShiftEntry = { shiftId: string; hours: number };

/** Adds every selected shift on every selected date, skipping combinations that already exist. */
export const addAssignments = (data: Data, workerId: string, dates: string[], entries: NewShiftEntry[]) => {
  const assignments = [...data.assignments];
  const created: Assignment[] = [];
  let skipped = 0;
  dates.forEach((date) => {
    entries.forEach((entry) => {
      const shift = data.shifts.find((item) => item.id === entry.shiftId);
      if (!shift) return;
      if (assignments.some((item) => item.workerId === workerId && item.date === date && item.shiftId === shift.id)) {
        skipped += 1;
        return;
      }
      const assignment: Assignment = { id: createId(), workerId, date, ...paymentService.snapshot(shift, entry.hours) };
      assignments.push(assignment);
      created.push(assignment);
    });
  });
  return { data: { ...data, assignments }, created, skipped };
};

export type AssignmentChanges = { workerId: string; date: string; shiftId: string; hours: number };

/**
 * Edits one assignment. The payment snapshot is kept unless the shift itself is changed, in which case
 * the new shift's current configuration is applied.
 */
export const updateAssignment = (data: Data, id: string, changes: AssignmentChanges): { data: Data; error?: string } => {
  const current = data.assignments.find((item) => item.id === id);
  if (!current) return { data, error: 'Este turno ya no existe.' };
  if (hasShift(data, changes.workerId, changes.date, changes.shiftId, id)) return { data, error: duplicateShiftMessage };
  let next: Assignment = { ...current, workerId: changes.workerId, date: changes.date, hours: changes.hours };
  if (changes.shiftId !== current.shiftId) {
    const shift = data.shifts.find((item) => item.id === changes.shiftId);
    if (!shift) return { data, error: 'Ese turno ya no existe.' };
    next = { ...next, ...paymentService.snapshot(shift, changes.hours) };
  }
  return { data: { ...data, assignments: data.assignments.map((item) => (item.id === id ? next : item)) } };
};

// A worker is "on" a day only through their shifts, so removing the last shift removes them from that day.
export const removeAssignment = (data: Data, id: string): Data => ({ ...data, assignments: data.assignments.filter((item) => item.id !== id) });

const shiftOrder = (data: Data) => (shiftId: string) => {
  const index = data.shifts.findIndex((shift) => shift.id === shiftId);
  return index === -1 ? data.shifts.length : index;
};

/** Groups records per worker, keeping the worker order and, inside each worker, date then shift order. */
export const groupByWorker = (data: Data, assignments: Assignment[]) => {
  const order = shiftOrder(data);
  return data.workers
    .map((worker) => ({
      worker,
      items: assignments
        .filter((item) => item.workerId === worker.id)
        .sort((a, b) => a.date.localeCompare(b.date) || order(a.shiftId) - order(b.shiftId)),
    }))
    .filter((group) => group.items.length);
};

export type WeekTotal = { start: string; end: string; shifts: number; total: number };

/**
 * Splits a period into Monday–Sunday weeks (as the calendar shows them), clipped to the period, and adds
 * up the payment snapshots of the shifts in each one. Hours play no part in what is paid.
 */
export const weeklyTotals = (assignments: Assignment[], startDate: string, endDate: string): WeekTotal[] => {
  const weeks: WeekTotal[] = [];
  let cursor = new Date(`${startDate}T12:00:00`);
  while (isoDay(cursor) <= endDate) {
    const sunday = endOfWeek(cursor, { weekStartsOn: 1 });
    const start = isoDay(cursor);
    const end = isoDay(sunday) < endDate ? isoDay(sunday) : endDate;
    const items = assignments.filter((item) => item.date >= start && item.date <= end);
    weeks.push({ start, end, shifts: items.length, total: paymentService.total(items) });
    cursor = addDays(sunday, 1);
  }
  return weeks;
};

export type PaymentLine = { name: string; unit: number; count: number; total: number };

/** "Mañana × 3 = 90 €" lines: shifts grouped by their saved name and saved payment, in the order they were worked. */
export const paymentBreakdown = (assignments: Assignment[]): PaymentLine[] => {
  const lines = new Map<string, PaymentLine>();
  [...assignments].sort((a, b) => a.date.localeCompare(b.date)).forEach((item) => {
    const key = `${item.shiftNameSnapshot}|${item.paymentSnapshot}`;
    const line = lines.get(key) ?? { name: item.shiftNameSnapshot, unit: item.paymentSnapshot, count: 0, total: 0 };
    lines.set(key, { ...line, count: line.count + 1, total: Math.round((line.total + item.paymentSnapshot) * 100) / 100 });
  });
  return [...lines.values()];
};

export const groupByDate = (data: Data, assignments: Assignment[]) => {
  const order = shiftOrder(data);
  const dates = [...new Set(assignments.map((item) => item.date))].sort();
  return dates.map((date) => {
    const items = assignments.filter((item) => item.date === date).sort((a, b) => order(a.shiftId) - order(b.shiftId));
    return { date, items, hours: paymentService.hours(items), total: paymentService.total(items) };
  });
};
