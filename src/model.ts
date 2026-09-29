export type Worker = { id: string; name: string; color: string; archived?: boolean };
export type Shift = { id: string; name: string; icon: string; color: string; defaultHours: number; paymentAmount: number; active: boolean };
export type Assignment = {
  id: string;
  workerId: string;
  date: string;
  shiftId: string;
  shiftNameSnapshot: string;
  hours: number;
  paymentSnapshot: number;
};
export type Data = { version: 2; workers: Worker[]; shifts: Shift[]; assignments: Assignment[] };

export const storageKey = 'montrack-data';
export const legacyBackupKey = 'montrack-data-v1-backup';
export const storageLimitBytes = 5 * 1024 * 1024;

export const colorGroups = [
  ['#16A34A', '#166534', '#86EFAC'],
  ['#EA580C', '#C2410C', '#FDBA74'],
  ['#2563EB', '#1D4ED8', '#93C5FD'],
  ['#D97706', '#B45309', '#FDE68A'],
  ['#DC2626', '#991B1B', '#FCA5A5'],
  ['#7C3AED', '#6D28D9', '#DDD6FE'],
  ['#0F766E', '#115E59', '#99F6E4'],
  ['#92400E', '#78350F', '#D6B99A'],
  ['#0891B2', '#0E7490', '#A5F3FC'],
  ['#DB2777', '#BE185D', '#F9A8D4'],
  ['#4338CA', '#312E81', '#C7D2FE'],
  ['#4D7C0F', '#3F6212', '#D9F99D'],
];
const palette = [0, 1, 2].flatMap((variant) => colorGroups.map((group) => group[variant]));
const archivedColor = '#94A3B8';

// Prefer a color no active worker uses yet, so colors stay distinguishable after deletions.
export const nextWorkerColor = (workers: Worker[]) => {
  const used = new Set(workers.filter((worker) => !worker.archived).map((worker) => worker.color.toUpperCase()));
  return palette.find((color) => !used.has(color.toUpperCase())) ?? palette[workers.length % palette.length];
};

export const shiftIcons = ['☀️', '🌇', '🌙', '⭐', '🕒', '🎉'];
export const defaultShifts: Shift[] = [
  { id: 'morning', name: 'Mañana', icon: '☀️', color: '#F59E0B', defaultHours: 6, paymentAmount: 30, active: true },
  { id: 'afternoon', name: 'Tarde', icon: '🌇', color: '#EA580C', defaultHours: 6, paymentAmount: 25, active: true },
  { id: 'night', name: 'Noche', icon: '🌙', color: '#4338CA', defaultHours: 12, paymentAmount: 30, active: true },
];

export const emptyData = (): Data => ({ version: 2, workers: [], shifts: defaultShifts.map((shift) => ({ ...shift })), assignments: [] });

export const createId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const roundMoney = (value: number) => Math.round(value * 100) / 100;

const num = (value: unknown, fallback: number) => {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};
const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value : fallback);
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

// Records that point to a worker that no longer exists are kept under an archived placeholder worker.
const ensureWorker = (workers: Worker[], workerId: string) => {
  if (!workers.some((worker) => worker.id === workerId)) {
    workers.push({ id: workerId, name: 'Trabajador eliminado', color: archivedColor, archived: true });
  }
};

/**
 * Converts version 1 data (workers with a permanent day/night type and proportional pay) into the
 * shift-based model. Nothing is dropped: a "day" record becomes a Mañana shift, a "night" record a
 * Noche shift, and each record keeps the amount the old app showed for it as its payment snapshot.
 */
export const migrateV1 = (saved: any): Data => {
  const legacyConfig = saved?.paymentConfig ?? {};
  const [morning, afternoon, night] = defaultShifts;
  const rule = (type: 'day' | 'night', fallback: Shift) => {
    const hours = num(legacyConfig?.[type]?.standardHours, fallback.defaultHours);
    return {
      standardHours: hours > 0 ? hours : fallback.defaultHours,
      standardPayment: Math.max(0, num(legacyConfig?.[type]?.standardPayment, fallback.paymentAmount)),
    };
  };
  const dayRule = rule('day', morning);
  const nightRule = rule('night', night);
  const shifts: Shift[] = [
    { ...morning, defaultHours: dayRule.standardHours, paymentAmount: dayRule.standardPayment },
    { ...afternoon },
    { ...night, defaultHours: nightRule.standardHours, paymentAmount: nightRule.standardPayment },
  ];

  const typeOf = new Map<string, 'day' | 'night'>();
  const workers: Worker[] = (Array.isArray(saved?.workers) ? saved.workers : [])
    .filter((raw: any) => raw && typeof raw === 'object')
    .map((raw: any, index: number) => {
      const id = text(raw.id, createId());
      typeOf.set(id, raw.type === 'night' ? 'night' : 'day');
      return { id, name: text(raw.name, `Trabajador ${index + 1}`), color: text(raw.color, palette[index % palette.length]) };
    });

  const assignments: Assignment[] = [];
  (Array.isArray(saved?.assignments) ? saved.assignments : []).forEach((raw: any) => {
    if (!raw || !isDate(raw.date)) return;
    const workerId = text(raw.workerId, 'unknown');
    ensureWorker(workers, workerId);
    const isNight = typeOf.get(workerId) === 'night';
    const shift = isNight ? shifts[2] : shifts[0];
    const legacyRule = isNight ? nightRule : dayRule;
    const hours = Math.max(0, num(raw.workedHours, legacyRule.standardHours));
    assignments.push({
      id: text(raw.id, createId()),
      workerId,
      date: raw.date,
      shiftId: shift.id,
      shiftNameSnapshot: shift.name,
      hours,
      paymentSnapshot: roundMoney((hours * legacyRule.standardPayment) / legacyRule.standardHours),
    });
  });

  return { version: 2, workers, shifts, assignments };
};

/** Cleans version 2 data coming from storage or a backup file without discarding valid records. */
export const normalizeV2 = (saved: any): Data => {
  const shifts: Shift[] = (Array.isArray(saved?.shifts) ? saved.shifts : [])
    .filter((raw: any) => raw && typeof raw === 'object')
    .map((raw: any, index: number) => ({
      id: text(raw.id, createId()),
      name: text(raw.name, `Turno ${index + 1}`),
      icon: text(raw.icon, '🕒'),
      color: text(raw.color, '#64748B'),
      defaultHours: num(raw.defaultHours, 0) > 0 ? num(raw.defaultHours, 0) : 1,
      paymentAmount: Math.max(0, num(raw.paymentAmount, 0)),
      active: raw.active !== false,
    }));
  if (!shifts.some((shift) => shift.active)) shifts.push(...defaultShifts.filter((shift) => !shifts.some((entry) => entry.id === shift.id)).map((shift) => ({ ...shift })));

  const workers: Worker[] = (Array.isArray(saved?.workers) ? saved.workers : [])
    .filter((raw: any) => raw && typeof raw === 'object')
    .map((raw: any, index: number) => ({
      id: text(raw.id, createId()),
      name: text(raw.name, `Trabajador ${index + 1}`),
      color: text(raw.color, palette[index % palette.length]),
      ...(raw.archived ? { archived: true } : {}),
    }));

  const assignments: Assignment[] = [];
  (Array.isArray(saved?.assignments) ? saved.assignments : []).forEach((raw: any) => {
    if (!raw || !isDate(raw.date)) return;
    const workerId = text(raw.workerId, 'unknown');
    ensureWorker(workers, workerId);
    const shift = shifts.find((entry) => entry.id === raw.shiftId);
    assignments.push({
      id: text(raw.id, createId()),
      workerId,
      date: raw.date,
      shiftId: text(raw.shiftId, shift?.id ?? 'unknown'),
      shiftNameSnapshot: text(raw.shiftNameSnapshot, shift?.name ?? 'Turno'),
      hours: Math.max(0, num(raw.hours, shift?.defaultHours ?? 0)),
      paymentSnapshot: Math.max(0, num(raw.paymentSnapshot, shift?.paymentAmount ?? 0)),
    });
  });

  return { version: 2, workers, shifts, assignments };
};

const isV2 = (saved: any) => saved?.version === 2 || Array.isArray(saved?.shifts);

/** Accepts any stored or imported shape (v1, v2, or a v2 backup file with metadata) and returns v2 data. */
export const toCurrentData = (saved: any): Data => {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Formato no válido');
  const payload = saved.data && typeof saved.data === 'object' && !Array.isArray(saved.data) ? saved.data : saved;
  if (!Array.isArray(payload.workers) && !Array.isArray(payload.assignments)) throw new Error('Formato no válido');
  return isV2(payload) ? normalizeV2(payload) : migrateV1(payload);
};

export const loadData = (storage: Storage = localStorage): Data => {
  let raw: string | null = null;
  try {
    raw = storage.getItem(storageKey);
  } catch {
    return emptyData();
  }
  if (!raw) return emptyData();
  try {
    const saved = JSON.parse(raw);
    if (isV2(saved)) return normalizeV2(saved);
    // Keep an untouched copy of the old data before the first migration, in case anything must be recovered.
    try {
      if (!storage.getItem(legacyBackupKey)) storage.setItem(legacyBackupKey, raw);
    } catch {
      // A full storage must not block the migration itself.
    }
    return migrateV1(saved);
  } catch {
    // Data that cannot be read is copied aside before the app starts fresh, never discarded.
    try {
      storage.setItem(`${storageKey}-unreadable-${Date.now()}`, raw);
    } catch {
      // Ignore: the original key stays intact until the next successful save.
    }
    return emptyData();
  }
};

export const saveData = (data: Data, storage: Storage = localStorage) => {
  try {
    storage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
};

export const storageUsage = (data: Data) => new Blob([JSON.stringify(data)]).size;
