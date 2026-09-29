import { describe, expect, it } from 'vitest';
import { emptyData, legacyBackupKey, loadData, migrateV1, storageKey, toCurrentData, type Data } from './model';
import { addAssignments, duplicateShiftMessage, groupByWorker, paymentService, removeAssignment, updateAssignment } from './payment';
import { buildBackup, buildReport, buildReportText, createExcelBlob, createPdfBlob, filterData } from './exports';
import { zip } from './xlsx';

const memoryStorage = (initial: Record<string, string> = {}): Storage => {
  const store = new Map(Object.entries(initial));
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    removeItem: (key) => { store.delete(key); },
    setItem: (key, value) => { store.set(key, String(value)); },
  };
};

const legacy = {
  workers: [
    { id: 'w1', name: 'María García', color: '#2563EB', defaultHours: 6, type: 'day' },
    { id: 'w2', name: 'Daniel Pérez', color: '#DC2626', defaultHours: 12, type: 'night' },
  ],
  assignments: [
    { id: 'a1', workerId: 'w1', date: '2026-09-01', workedHours: 6 },
    { id: 'a2', workerId: 'w1', date: '2026-09-02', workedHours: 7 },
    { id: 'a3', workerId: 'w2', date: '2026-09-01', workedHours: 12 },
    { id: 'a4', workerId: 'gone', date: '2026-09-03', workedHours: 4 },
  ],
  paymentConfig: { day: { standardHours: 6, standardPayment: 30 }, night: { standardHours: 12, standardPayment: 30 } },
};

const withWorkers = (): Data => ({
  ...emptyData(),
  workers: [
    { id: 'maria', name: 'María', color: '#16A34A' },
    { id: 'daniel', name: 'Daniel', color: '#EA580C' },
  ],
});

describe('migration from version 1', () => {
  it('keeps every worker, date, hour and color, and converts types into shifts', () => {
    const data = migrateV1(legacy);
    expect(data.version).toBe(2);
    expect(data.workers.slice(0, 2)).toEqual([
      { id: 'w1', name: 'María García', color: '#2563EB' },
      { id: 'w2', name: 'Daniel Pérez', color: '#DC2626' },
    ]);
    expect(data.assignments).toHaveLength(4);
    const byId = Object.fromEntries(data.assignments.map((item) => [item.id, item]));
    expect(byId.a1).toMatchObject({ date: '2026-09-01', shiftId: 'morning', shiftNameSnapshot: 'Mañana', hours: 6, paymentSnapshot: 30 });
    // The old proportional amount the user saw (7 h × 5 €/h) is preserved as the snapshot.
    expect(byId.a2).toMatchObject({ shiftId: 'morning', hours: 7, paymentSnapshot: 35 });
    expect(byId.a3).toMatchObject({ shiftId: 'night', shiftNameSnapshot: 'Noche', hours: 12, paymentSnapshot: 30 });
  });

  it('keeps records of already-deleted workers under an archived placeholder', () => {
    const data = migrateV1(legacy);
    expect(data.assignments.find((item) => item.id === 'a4')).toMatchObject({ workerId: 'gone', hours: 4 });
    expect(data.workers.find((worker) => worker.id === 'gone')).toMatchObject({ archived: true, name: 'Trabajador eliminado' });
  });

  it('carries custom legacy payment settings into the Mañana and Noche shifts', () => {
    const data = migrateV1({ ...legacy, paymentConfig: { day: { standardHours: 8, standardPayment: 40 }, night: { standardHours: 10, standardPayment: 50 } } });
    expect(data.shifts.map((shift) => [shift.name, shift.defaultHours, shift.paymentAmount])).toEqual([
      ['Mañana', 8, 40], ['Tarde', 6, 25], ['Noche', 10, 50],
    ]);
  });

  it('migrates stored data on load and keeps an untouched copy of the old data', () => {
    const raw = JSON.stringify(legacy);
    const storage = memoryStorage({ [storageKey]: raw });
    const data = loadData(storage);
    expect(data.assignments).toHaveLength(4);
    expect(storage.getItem(legacyBackupKey)).toBe(raw);
  });

  it('starts with the three default shifts when there is no data', () => {
    const data = loadData(memoryStorage());
    expect(data.shifts.map((shift) => [shift.name, shift.defaultHours, shift.paymentAmount])).toEqual([
      ['Mañana', 6, 30], ['Tarde', 6, 25], ['Noche', 12, 30],
    ]);
    expect(data.workers).toEqual([]);
  });

  it('never discards unreadable storage', () => {
    const storage = memoryStorage({ [storageKey]: '{broken' });
    loadData(storage);
    const copies = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key) => key?.startsWith(`${storageKey}-unreadable-`));
    expect(copies).toHaveLength(1);
    expect(storage.getItem(copies[0]!)).toBe('{broken');
  });
});

describe('shift assignment', () => {
  it('assigns several shifts to the same worker and day with fixed payments', () => {
    const { data, created } = addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 7 }, { shiftId: 'night', hours: 10 }]);
    expect(created).toHaveLength(2);
    expect(data.assignments.map((item) => [item.shiftNameSnapshot, item.hours, item.paymentSnapshot])).toEqual([['Mañana', 7, 30], ['Noche', 10, 30]]);
    expect(paymentService.summarize(data.assignments)).toMatchObject({ days: 1, hours: 17, total: 60 });
  });

  it('assigns the selected shifts on every selected date', () => {
    const dates = ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-06'];
    const { data, created } = addAssignments(withWorkers(), 'maria', dates, [{ shiftId: 'morning', hours: 6 }, { shiftId: 'night', hours: 12 }]);
    expect(created).toHaveLength(8);
    expect(paymentService.summarize(data.assignments)).toMatchObject({ days: 4, hours: 72, total: 240, averageHours: 18 });
  });

  it('refuses the exact same shift twice for a worker on one day', () => {
    const first = addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 6 }]);
    const second = addAssignments(first.data, 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 6 }]);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toBe(1);
    expect(second.data.assignments).toHaveLength(1);
    // A different worker may have the same shift.
    expect(addAssignments(first.data, 'daniel', ['2026-09-29'], [{ shiftId: 'morning', hours: 6 }]).created).toHaveLength(1);
  });

  it('saves hours as the shift default only when asked', () => {
    expect(addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 7 }]).data.shifts[0].defaultHours).toBe(6);
    expect(addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 7 }], true).data.shifts[0].defaultHours).toBe(7);
  });

  it('does not change existing records when a shift configuration changes', () => {
    const { data } = addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 6 }]);
    const changed = { ...data, shifts: data.shifts.map((shift) => (shift.id === 'morning' ? { ...shift, name: 'Mañana larga', defaultHours: 7, paymentAmount: 35 } : shift)) };
    expect(changed.assignments[0]).toMatchObject({ shiftNameSnapshot: 'Mañana', hours: 6, paymentSnapshot: 30 });
    const next = addAssignments(changed, 'maria', ['2026-09-30'], [{ shiftId: 'morning', hours: 7 }]).data;
    expect(next.assignments[1]).toMatchObject({ shiftNameSnapshot: 'Mañana larga', paymentSnapshot: 35 });
  });
});

describe('editing and deleting', () => {
  const base = () => addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 6 }, { shiftId: 'night', hours: 12 }]).data;

  it('keeps the payment snapshot when only hours, date or worker change', () => {
    const data = base();
    const result = updateAssignment(data, data.assignments[0].id, { workerId: 'daniel', date: '2026-09-30', shiftId: 'morning', hours: 8 });
    expect(result.error).toBeUndefined();
    expect(result.data.assignments[0]).toMatchObject({ workerId: 'daniel', date: '2026-09-30', hours: 8, paymentSnapshot: 30 });
  });

  it('applies the new shift configuration when the shift itself changes', () => {
    const data = base();
    const result = updateAssignment(data, data.assignments[0].id, { workerId: 'maria', date: '2026-09-29', shiftId: 'afternoon', hours: 5.5 });
    expect(result.data.assignments[0]).toMatchObject({ shiftId: 'afternoon', shiftNameSnapshot: 'Tarde', hours: 5.5, paymentSnapshot: 25 });
  });

  it('rejects an edit that would duplicate a shift', () => {
    const data = base();
    const result = updateAssignment(data, data.assignments[0].id, { workerId: 'maria', date: '2026-09-29', shiftId: 'night', hours: 6 });
    expect(result.error).toBe(duplicateShiftMessage);
    expect(result.data).toBe(data);
  });

  it('removes one shift only, and the worker disappears from the day with the last one', () => {
    const data = base();
    const [morning, night] = data.assignments;
    const afterNight = removeAssignment(data, night.id);
    expect(afterNight.assignments).toEqual([morning]);
    expect(groupByWorker(afterNight, afterNight.assignments)).toHaveLength(1);
    const afterAll = removeAssignment(afterNight, morning.id);
    expect(groupByWorker(afterAll, afterAll.assignments.filter((item) => item.date === '2026-09-29'))).toHaveLength(0);
  });
});

describe('exports and backup', () => {
  const sample = () => {
    let data = addAssignments(withWorkers(), 'maria', ['2026-09-29'], [{ shiftId: 'morning', hours: 6 }, { shiftId: 'night', hours: 12 }]).data;
    data = addAssignments(data, 'maria', ['2026-09-30'], [{ shiftId: 'afternoon', hours: 6 }]).data;
    data = addAssignments(data, 'daniel', ['2026-10-02'], [{ shiftId: 'afternoon', hours: 6 }]).data;
    return data;
  };
  const september = { startDate: '2026-09-01', endDate: '2026-09-30', workerIds: ['maria'] };

  it('builds a per-worker report limited to the selected workers and dates', () => {
    const report = buildReport(sample(), september);
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0].summary).toMatchObject({ days: 2, hours: 24, total: 85 });
    expect(filterData(sample(), september).assignments).toHaveLength(3);
  });

  it('writes a readable TXT report', () => {
    const text = buildReportText(buildReport(sample(), september));
    expect(text).toContain('MONTRACK\nPeriodo: 01/09/2026 - 30/09/2026');
    expect(text).toContain('MARÍA');
    expect(text).toContain('29/09/2026\nMañana — 6 h — 30 €\nNoche — 12 h — 30 €');
    expect(text).toContain('TOTAL\nDías: 2\nHoras: 24 h\nTotal: 85 €');
  });

  it('produces a JSON backup that restores to the same data', () => {
    const data = sample();
    const backup = JSON.parse(JSON.stringify(buildBackup(data, { startDate: '2026-01-01', endDate: '2026-12-31', workerIds: ['maria', 'daniel'] })));
    expect(backup).toMatchObject({ app: 'Montrack', version: 2, period: { startDate: '2026-01-01', endDate: '2026-12-31' } });
    expect(toCurrentData(backup)).toEqual(data);
  });

  it('accepts a version 1 backup file on import and rejects unrelated JSON', () => {
    expect(toCurrentData(legacy).assignments).toHaveLength(4);
    expect(() => toCurrentData([])).toThrow();
    expect(() => toCurrentData({ hello: 'world' })).toThrow();
  });

  it('creates a valid xlsx (zip) package', async () => {
    const blob = createExcelBlob(buildReport(sample(), september));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('<autoFilter ref="A1:E4"/>');
    expect(text).toContain('Mañana');
  });

  it('keeps worker colours out of PDF, Excel and TXT, but in the JSON backup', async () => {
    // Magenta is used nowhere else in the reports, so any trace of it would be the worker colour.
    const data = { ...sample(), workers: sample().workers.map((worker) => ({ ...worker, color: '#FF00FF' })) };
    const report = buildReport(data, september);
    const pdf = await createPdfBlob(report).text();
    expect(pdf).toContain('Total de Mar');
    expect(pdf).not.toMatch(/1\.? 0\.? 1\.? (rg|RG)/);
    const xlsx = new TextDecoder().decode(new Uint8Array(await createExcelBlob(report).arrayBuffer()));
    expect(xlsx.toUpperCase()).not.toContain('FF00FF');
    expect(buildReportText(report)).not.toContain('#');
    expect(buildBackup(data, september).data.workers[0].color).toBe('#FF00FF');
  });

  it('formats money in Spanish', () => {
    expect(paymentService.money(30)).toBe('30 €');
    expect(paymentService.money(30.5)).toBe('30,50 €');
  });
});

describe('zip writer', () => {
  it('writes the end-of-central-directory record with the entry count', () => {
    const bytes = zip([['a.txt', 'hola'], ['b.txt', 'adiós']]);
    const view = new DataView(bytes.buffer);
    const end = bytes.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
  });
});
