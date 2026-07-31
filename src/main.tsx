import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { jsPDF } from 'jspdf';
import { addDays, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, isWithinInterval, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { es } from 'date-fns/locale';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FileDown, History, Mountain, Pencil, Plus, Settings, Trash2, Upload, Users, X } from 'lucide-react';
import './styles.css';

type WorkerType = 'day' | 'night';
type Worker = { id: string; name: string; color: string; defaultHours: number; type: WorkerType };
type Assignment = { id: string; workerId: string; date: string; workedHours: number };
type PaymentRule = { standardHours: number; standardPayment: number };
type PaymentConfig = Record<WorkerType, PaymentRule>;
type Data = { workers: Worker[]; assignments: Assignment[]; paymentConfig: PaymentConfig };
type ExportFormat = 'pdf' | 'excel' | 'txt' | 'json';
type ExportAction = 'preview' | 'share' | ExportFormat;
type ExportConfig = { startDate: string; endDate: string; workerIds: string[] };

const key = 'montrack-data';
const colorGroups = [
  { variants: ['#16A34A', '#166534', '#86EFAC'] },
  { variants: ['#EA580C', '#C2410C', '#FDBA74'] },
  { variants: ['#2563EB', '#1D4ED8', '#93C5FD'] },
  { variants: ['#D97706', '#B45309', '#FDE68A'] },
  { variants: ['#DC2626', '#991B1B', '#FCA5A5'] },
  { variants: ['#7C3AED', '#6D28D9', '#DDD6FE'] },
  { variants: ['#0F766E', '#115E59', '#99F6E4'] },
  { variants: ['#92400E', '#78350F', '#D6B99A'] },
  { variants: ['#0891B2', '#0E7490', '#A5F3FC'] },
  { variants: ['#DB2777', '#BE185D', '#F9A8D4'] },
  { variants: ['#4338CA', '#312E81', '#C7D2FE'] },
  { variants: ['#4D7C0F', '#3F6212', '#D9F99D'] },
];
const defaultPayments: PaymentConfig = { day: { standardHours: 6, standardPayment: 30 }, night: { standardHours: 12, standardPayment: 30 } };
const paymentService = {
  rate: (config: PaymentConfig, type: WorkerType) => config[type].standardPayment / config[type].standardHours,
  amount: (hours: number, worker: Worker, config: PaymentConfig) => hours * paymentService.rate(config, worker.type),
  money: (value: number) => `${value.toFixed(2)} €`,
};
const nextWorkerColor = (workers: Worker[]) => {
  const index = workers.length;
  const group = colorGroups[index % colorGroups.length];
  const variantIndex = Math.floor(index / colorGroups.length) % group.variants.length;
  return group.variants[variantIndex] ?? group.variants[0];
};
const base: Data = {
  workers: [
    { id: 'w1', name: 'María García', color: colorGroups[2].variants[0], defaultHours: 6, type: 'day' },
    { id: 'w2', name: 'Daniel Pérez', color: colorGroups[4].variants[0], defaultHours: 12, type: 'night' },
    { id: 'w3', name: 'Lucía Martín', color: colorGroups[0].variants[0], defaultHours: 6, type: 'day' },
  ],
  assignments: [],
  paymentConfig: defaultPayments,
};
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const formatDateText = (value: string | Date) => format(value instanceof Date ? value : new Date(`${value}T12:00:00`), 'dd/MM/yyyy');
const formatRangeText = (start: string, end: string) => `${formatDateText(start)} - ${formatDateText(end)}`;
const typeLabel = (type: WorkerType) => (type === 'day' ? 'Diurno' : 'Nocturno');
const minSelectableYear = 2026;

const getData = (): Data => {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved) return base;
    const config = { ...defaultPayments, ...saved.paymentConfig };
    return {
      ...base,
      ...saved,
      paymentConfig: {
        day: { ...defaultPayments.day, ...config.day },
        night: { ...defaultPayments.night, ...config.night },
      },
      workers: (saved.workers || []).map((w: any, i: number) => ({
        ...w,
        color: w.color || colorGroups[i % colorGroups.length].variants[0],
        type: w.type || 'day',
      })),
    };
  } catch {
    return base;
  }
};

const defaultExportConfig = (data: Data): ExportConfig => {
  const allDates = [...data.assignments].map((a) => a.date).sort();
  const startDate = allDates[0] || iso(new Date());
  const endDate = allDates[allDates.length - 1] || iso(new Date());
  return { startDate, endDate, workerIds: data.workers.map((worker) => worker.id) };
};

const exportSections = (data: Data) => data.workers.map((worker) => {
  const assignments = data.assignments.filter((a) => a.workerId === worker.id);
  const hours = assignments.reduce((count, a) => count + a.workedHours, 0);
  const total = paymentService.amount(hours, worker, data.paymentConfig);
  return { worker, assignments, hours, total };
});

const filteredDataForExport = (data: Data, config: ExportConfig): Data => {
  const normalizedStart = config.startDate <= config.endDate ? config.startDate : config.endDate;
  const normalizedEnd = config.startDate <= config.endDate ? config.endDate : config.startDate;
  const selected = new Set(config.workerIds ?? []);
  return {
    ...data,
    workers: data.workers.filter((worker) => selected.has(worker.id)),
    assignments: data.assignments.filter(
      (assignment) => selected.has(assignment.workerId) && assignment.date >= normalizedStart && assignment.date <= normalizedEnd,
    ),
    paymentConfig: data.paymentConfig,
  };
};

const buildReportText = (data: Data, config: ExportConfig) => {
  const sections = exportSections(data);
  const title = ['Montrack', 'Work Report', formatRangeText(config.startDate, config.endDate)].join('\n');
  if (!sections.length) return `${title}\n\nNo workers selected for this export.`;

  const lines: string[] = [title, ''];
  sections.forEach(({ worker, assignments, hours, total }) => {
    lines.push(`${worker.name}`);
    lines.push(`Type: ${typeLabel(worker.type)}`);
    lines.push(`Assignments: ${assignments.length}`);
    lines.push(`Hours: ${hours.toFixed(2)} h`);
    lines.push(`Total: ${paymentService.money(total)}`);
    if (assignments.length) {
      lines.push('');
      assignments
        .slice()
        .sort((a, b) => b.date.localeCompare(a.date))
        .forEach((item) => {
          lines.push(`- ${formatDateText(item.date)} | ${item.workedHours.toFixed(2)} h | ${paymentService.money(paymentService.amount(item.workedHours, worker, data.paymentConfig))}`);
        });
      lines.push('');
    } else {
      lines.push('No assignments in selected date range.');
      lines.push('');
    }
  });
  return lines.join('\n').trim();
};

const buildFileName = (format: ExportFormat, config: ExportConfig) => {
  const period = `${config.startDate.replace(/-/g, '')}_${config.endDate.replace(/-/g, '')}`;
  return `montrack-${format}-${period}.${format === 'excel' ? 'xlsx' : format}`;
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};

const shareBlob = async (blob: Blob, fileName: string) => {
  const file = new File([blob], fileName, { type: blob.type });
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator && typeof navigator.canShare === 'function';
  if (canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: 'Montrack', text: 'Montrack work report', files: [file] });
      return;
    } catch {
      // Fall back to browser download when the share request is cancelled or unsupported.
    }
  }
  downloadBlob(blob, fileName);
};

const createPdfBlob = (data: Data, config: ExportConfig) => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 18;
  const pageWidth = 210;
  const pageHeight = 297;
  let y = 20;
  const ensure = (height: number) => {
    if (y + height > pageHeight - 18) {
      pdf.addPage();
      y = 20;
    }
  };

  pdf.setFontSize(22);
  pdf.setTextColor('#172238');
  pdf.text('Montrack', margin, y);
  y += 8;
  pdf.setFontSize(16);
  pdf.text('Work Report', margin, y);
  y += 6;
  pdf.setFontSize(10);
  pdf.setTextColor('#69758a');
  pdf.text(formatRangeText(config.startDate, config.endDate), margin, y);
  y += 12;

  const sections = exportSections(data);
  sections.forEach(({ worker, assignments, hours, total }) => {
    ensure(36);
    pdf.setFillColor(worker.color);
    pdf.roundedRect(margin, y - 4, 4, 16, 2, 2, 'F');
    pdf.setTextColor('#172238');
    pdf.setFontSize(14);
    pdf.text(worker.name, margin + 10, y + 2);
    y += 8;
    pdf.setFontSize(9);
    pdf.setTextColor('#69758a');
    pdf.text(`${typeLabel(worker.type)} · ${assignments.length} assignments`, margin + 10, y);
    y += 8;
    pdf.setFillColor('#edf2f7');
    pdf.rect(margin, y - 4, pageWidth - margin * 2, 8, 'F');
    pdf.setTextColor('#475569');
    pdf.setFontSize(8);
    pdf.text('Date', margin + 3, y + 1);
    pdf.text('Hours', margin + 76, y + 1);
    pdf.text('Amount', margin + 115, y + 1);
    y += 7;

    assignments
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .forEach((assignment) => {
        ensure(9);
        pdf.setDrawColor('#e5e7eb');
        pdf.line(margin, y + 2, pageWidth - margin, y + 2);
        pdf.setTextColor('#172238');
        pdf.text(formatDateText(assignment.date), margin + 3, y + 5);
        pdf.text(String(assignment.workedHours.toFixed(2)), margin + 76, y + 5);
        pdf.text(paymentService.amount(assignment.workedHours, worker, data.paymentConfig).toFixed(2) + ' €', margin + 115, y + 5);
        y += 8;
      });

    ensure(12);
    pdf.setFontSize(9);
    pdf.setTextColor('#172238');
    pdf.text(`Assignments: ${assignments.length}   ·   Hours: ${hours.toFixed(2)}   ·   Total: ${paymentService.money(total)}`, margin + 3, y + 2);
    y += 16;
  });

  pdf.setFillColor('#ffffff');
  pdf.rect(0, pageHeight - 12, pageWidth, 12, 'F');
  return pdf.output('blob');
};

const createExcelBlob = (data: Data, config: ExportConfig) => {
  const sections = exportSections(data);
  const header = ['Worker', 'Type', 'Date', 'Hours', 'Amount (€)'];
  const rows = sections.flatMap(({ worker, assignments }) => {
    const lines = assignments.length
      ? assignments
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((assignment) => [worker.name, typeLabel(worker.type), formatDateText(assignment.date), assignment.workedHours.toFixed(2), paymentService.amount(assignment.workedHours, worker, data.paymentConfig).toFixed(2)])
      : [[worker.name, typeLabel(worker.type), '—', '0.00', '0.00']];
    return [
      [worker.name, `${typeLabel(worker.type)} total`, '', `${sections.find((entry) => entry.worker.id === worker.id)?.hours.toFixed(2) || '0.00'}`, `${sections.find((entry) => entry.worker.id === worker.id)?.total.toFixed(2) || '0.00'}`],
      ...lines,
    ];
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet>
    <Table>
      <Row><Cell><Data ss:Type="String">${escapeXml('Montrack Work Report')}</Data></Cell></Row>
      <Row><Cell><Data ss:Type="String">${escapeXml(formatRangeText(config.startDate, config.endDate))}</Data></Cell></Row>
      <Row>${header.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(cell)}</Data></Cell>`).join('')}</Row>
      ${rows.map((row) => `<Row>${row.map((cell) => `<Cell><Data ss:Type="String">${escapeXml(String(cell))}</Data></Cell>`).join('')}</Row>`).join('')}
    </Table>
  </Worksheet>
</Workbook>`;

  return new Blob([xml], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

const createTextBlob = (data: Data, config: ExportConfig) => new Blob([buildReportText(data, config)], { type: 'text/plain;charset=utf-8' });
const createJsonBlob = (data: Data, config: ExportConfig) => new Blob([JSON.stringify(filteredDataForExport(data, config), null, 2)], { type: 'application/json' });

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

function App() {
  const [data, setData] = useState<Data>(getData);
  const [tab, setTab] = useState<'calendar' | 'history' | 'workers' | 'settings'>('calendar');
  const [cursor, setCursor] = useState(new Date());
  const [weekly, setWeekly] = useState(false);
  const [day, setDay] = useState<Date | null>(null);
  const [assign, setAssign] = useState<Worker | null>(null);
  const [editing, setEditing] = useState<Worker | null | undefined>(undefined);
  const [picker, setPicker] = useState(false);
  const [workerPicker, setWorkerPicker] = useState<Date | null>(null);
  const [assignDate, setAssignDate] = useState<Date | null>(null);
  const [toast, setToast] = useState('');
  const [exportConfigOpen, setExportConfigOpen] = useState(false);
  const [exportPreview, setExportPreview] = useState<{ title: string; content: string } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => localStorage.setItem(key, JSON.stringify(data)), [data]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 2300);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const saved = (message: string) => setToast(message);
  const worker = (id: string) => data.workers.find((entry) => entry.id === id);

  const saveWorker = (name: string, type: WorkerType, hours: number) => {
    setData((current) =>
      editing?.id
        ? {
            ...current,
            workers: current.workers.map((entry) => (entry.id === editing.id ? { ...entry, name, type, defaultHours: hours } : entry)),
          }
        : {
            ...current,
            workers: [...current.workers, { id: crypto.randomUUID(), name, type, color: nextWorkerColor(current.workers), defaultHours: hours }],
          },
    );
    setEditing(undefined);
    saved('Trabajador guardado');
  };

  const assignDays = (workerEntry: Worker, hours: number, dates: Date[], keep: boolean) => {
    setData((current) => {
      const present = new Set(current.assignments.filter((a) => a.workerId === workerEntry.id).map((a) => a.date));
      const extra = dates.filter((date) => !present.has(iso(date))).map((date) => ({ id: crypto.randomUUID(), workerId: workerEntry.id, date: iso(date), workedHours: hours }));
      return {
        ...current,
        workers: keep ? current.workers.map((entry) => (entry.id === workerEntry.id ? { ...entry, defaultHours: hours } : entry)) : current.workers,
        assignments: [...current.assignments, ...extra],
      };
    });
    setAssign(null);
    saved('Jornadas asignadas');
  };

  const startExport = (format: ExportAction) => {
    setExportConfigOpen(true);
  };

  const handleExportAction = async (action: ExportAction, config: ExportConfig) => {
    const filtered = filteredDataForExport(data, config);
    const exportText = buildReportText(filtered, config);
    if (action === 'preview') {
      setExportConfigOpen(false);
      setExportPreview({ title: `Montrack · ${formatRangeText(config.startDate, config.endDate)}`, content: exportText });
      return;
    }

    let blob: Blob;
    let fileName = buildFileName(action === 'share' ? 'pdf' : action, config);

    switch (action === 'share' ? 'pdf' : action) {
      case 'pdf':
        blob = createPdfBlob(filtered, config);
        break;
      case 'excel':
        blob = createExcelBlob(filtered, config);
        fileName = buildFileName('excel', config);
        break;
      case 'txt':
        blob = createTextBlob(filtered, config);
        fileName = buildFileName('txt', config);
        break;
      case 'json':
        blob = createJsonBlob(filtered, config);
        fileName = buildFileName('json', config);
        break;
      default:
        blob = createPdfBlob(filtered, config);
    }

    if (action === 'share') {
      await shareBlob(blob, fileName);
      return;
    }

    downloadBlob(blob, fileName);
    setExportConfigOpen(false);
    setExportPreview(null);
    saved(`${action.toUpperCase()} exportado`);
  };

  return (
    <main className="app">
      <header>
        <div className="brand"><span><Mountain /></span><h1>Montrack</h1></div>
      </header>
      {tab === 'calendar' && <Calendar data={data} cursor={cursor} weekly={weekly} setWeekly={setWeekly} setCursor={setCursor} openDay={setWorkerPicker} openAssign={setAssign} openPicker={() => setPicker(true)} />}
      {tab === 'history' && <HistoryView data={data} />}
      {tab === 'workers' && <Workers workers={data.workers} onEdit={setEditing} onDelete={(id: string) => { if (confirm('¿Eliminar a este trabajador?')) setData((current) => ({ ...current, workers: current.workers.filter((entry) => entry.id !== id) })); }} onAdd={() => setEditing(null)} />}
      {tab === 'settings' && <SettingsView data={data} importRef={importRef} onToast={saved} onImport={setData} onPayments={(paymentConfig: PaymentConfig) => setData((current) => ({ ...current, paymentConfig }))} onOpenExport={startExport} />}
      <nav>
        {([['calendar', CalendarDays, 'Calendario'], ['history', History, 'Historial'], ['workers', Users, 'Trabajadores'], ['settings', Settings, 'Ajustes']] as [string, any, string][]).map(([id, Icon, label]) => {
          const I = Icon;
          return (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id as any)}>
              <I />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>
      {workerPicker && <WorkerPicker workers={data.workers} close={() => setWorkerPicker(null)} onPick={(selected: Worker) => { setAssignDate(workerPicker); setWorkerPicker(null); setAssign(selected); }} />}
      {day && <DayModal date={day} data={data} close={() => setDay(null)} onDelete={(id: string) => setData((current) => ({ ...current, assignments: current.assignments.filter((a) => a.id !== id) }))} onEditHours={(id: string, hoursValue: number) => setData((current) => ({ ...current, assignments: current.assignments.map((a) => (a.id === id ? { ...a, workedHours: hoursValue } : a)) }))} onPickWorker={() => { setDay(null); setAssign(data.workers[0] || null); }} />}
      {assign && <AssignmentModal worker={assign} cursor={cursor} initialDate={assignDate} close={() => { setAssign(null); setAssignDate(null); }} onSave={assignDays} />}
      {editing !== undefined && <WorkerModal worker={editing || undefined} config={data.paymentConfig} close={() => setEditing(undefined)} onSave={saveWorker} />}
      {picker && <MonthPicker date={cursor} close={() => setPicker(false)} onPick={(date: Date) => { setCursor(date); setPicker(false); }} />}
      {exportConfigOpen && <ExportDialog data={data} onClose={() => setExportConfigOpen(false)} onAction={handleExportAction} />}
      {exportPreview && <PreviewModal title={exportPreview.title} content={exportPreview.content} onClose={() => setExportPreview(null)} />}
      {toast && <div className="toast"><Check />{toast}</div>}
    </main>
  );
}

function Calendar({ data, cursor, weekly, setWeekly, setCursor, openDay, openAssign, openPicker }: any) {
  const today = new Date();
  const start = weekly ? startOfWeek(cursor, { weekStartsOn: 1 }) : startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
  const end = weekly ? endOfWeek(cursor, { weekStartsOn: 1 }) : endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start, end });
  const assignments = (date: Date) => data.assignments.filter((a: Assignment) => a.date === iso(date));
  const workerOf = (id: string) => data.workers.find((entry: Worker) => entry.id === id);
  const notCurrent = !isSameMonth(cursor, today) || cursor.getFullYear() !== today.getFullYear();

  return (
    <section className="view">
      <div className="segmented">
        <button className={!weekly ? 'selected' : ''} onClick={() => setWeekly(false)}>Mes</button>
        <button className={weekly ? 'selected' : ''} onClick={() => setWeekly(true)}>Semana</button>
      </div>
      <div className="month-nav">
        <button onClick={() => setCursor(weekly ? addDays(cursor, -7) : subMonths(cursor, 1))}><ChevronLeft /></button>
        <button className="month-title" onClick={openPicker}>{format(cursor, 'MMMM yyyy', { locale: es })}<ChevronDown /></button>
        <button onClick={() => setCursor(weekly ? addDays(cursor, 7) : addMonths(cursor, 1))}><ChevronRight /></button>
      </div>
      <div className="worker-chips">
        {data.workers.map((entry: Worker) => (
          <button key={entry.id} onClick={() => openAssign(entry)}><i style={{ background: entry.color }} />{entry.name}<Plus /></button>
        ))}
      </div>
      <div className="calendar-card">
        <div className="week-labels">{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((dayLabel) => <span key={dayLabel}>{dayLabel}</span>)}</div>
        <div className="days">{days.map((date) => (
          <button key={date.toISOString()} onClick={() => openDay(date)} className={'day ' + (!isSameMonth(date, cursor) && !weekly ? 'muted ' : '') + (isSameDay(date, today) ? 'today' : '')}>
            <span>{format(date, 'd')}</span>
            <i>{assignments(date).slice(0, 4).map((a: Assignment) => <b key={a.id} style={{ background: workerOf(a.workerId)?.color }} />)}</i>
          </button>
        ))}</div>
      </div>
      {notCurrent && <button className="back-today" onClick={() => setCursor(today)}><Clock3 />Volver a hoy</button>}
    </section>
  );
}

function AssignmentModal({ worker, cursor, initialDate, close, onSave }: any) {
  const [hours, setHours] = useState(worker.defaultHours);
  const [keep, setKeep] = useState(false);
  const [selected, setSelected] = useState<Date[]>(initialDate ? [initialDate] : []);
  const days = eachDayOfInterval({ start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }), end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }) });
  const toggle = (date: Date) => setSelected((current) => current.some((item) => isSameDay(item, date)) ? current.filter((item) => !isSameDay(item, date)) : [...current, date]);

  return (
    <Modal close={close} className="assignment-modal">
      <p className="eyebrow">ASIGNAR JORNADAS</p>
      <div className="person-title"><i style={{ background: worker.color }} />{worker.name}</div>
      <label>Horas trabajadas<input autoFocus type="number" min="0" step="0.25" value={hours} onChange={(e) => setHours(+e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /><span>Guardar como horas por defecto</span></label>
      <p className="select-label">Selecciona los días</p>
      <div className="mini-calendar">
        <div>{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((dayLabel) => <span key={dayLabel}>{dayLabel}</span>)}</div>
        <div>{days.map((date) => <button key={date.toISOString()} onClick={() => toggle(date)} className={(isSameMonth(date, cursor) ? '' : 'muted ') + (selected.some((item) => isSameDay(item, date)) ? 'picked' : '')}>{format(date, 'd')}</button>)}</div>
      </div>
      <button disabled={!selected.length} className="primary full" onClick={() => onSave(worker, hours, selected, keep)}><Check />Asignar</button>
    </Modal>
  );
}

function WorkerPicker({ workers, close, onPick }: any) {
  return (
    <Modal close={close}>
      <p className="eyebrow">AÑADIR JORNADA</p>
      <h2>Selecciona un trabajador</h2>
      <div className="worker-picker">{workers.map((worker: Worker) => <button key={worker.id} onClick={() => onPick(worker)}><i style={{ background: worker.color }} /><span>{worker.name}</span><ChevronRight /></button>)}</div>
    </Modal>
  );
}

function DayModal({ date, data, close, onDelete, onEditHours, onPickWorker }: any) {
  const assignments = data.assignments.filter((x: Assignment) => x.date === iso(date));
  const workerOf = (id: string) => data.workers.find((w: Worker) => w.id === id);

  return (
    <Modal close={close}>
      <p className="eyebrow">DETALLE DEL DÍA</p>
      <h2>{format(date, "EEEE, d 'de' MMMM", { locale: es })}</h2>
      <div className="assignment-list">
        {assignments.length ? assignments.map((x: Assignment) => {
          const worker = workerOf(x.workerId);
          return (
            <article className="assignment" key={x.id}>
              <i style={{ background: worker?.color }} />
              <div>
                <strong>{worker?.name || 'Trabajador eliminado'}</strong>
                <input type="number" step=".25" value={x.workedHours} onChange={(e) => onEditHours(x.id, +e.target.value)} />
                <span>horas · {worker && paymentService.money(paymentService.amount(x.workedHours, worker, data.paymentConfig))}</span>
              </div>
              <button onClick={() => onDelete(x.id)}><Trash2 /></button>
            </article>
          );
        }) : <div className="empty"><Clock3 /><p>No hay jornadas registradas.</p></div>}
      </div>
      <button className="primary full" onClick={onPickWorker}><Plus />Añadir trabajador</button>
    </Modal>
  );
}

function Modal({ children, close, className = '' }: any) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={'modal ' + className}>
        <button className="close" onClick={close}><X /></button>
        {children}
      </section>
    </div>
  );
}

function WorkerModal({ worker, config, close, onSave }: any) {
  const [type, setType] = useState<WorkerType>(worker?.type || 'day');
  const [name, setName] = useState(worker?.name || '');
  const [hours, setHours] = useState(worker?.defaultHours || config.day.standardHours);
  const choose = (nextType: WorkerType) => { setType(nextType); if (!worker) setHours(config[nextType].standardHours); };

  return (
    <Modal close={close}>
      <p className="eyebrow">{worker ? 'EDITAR' : 'NUEVO'} TRABAJADOR</p>
      <h2>{worker ? 'Actualizar trabajador' : 'Añadir trabajador'}</h2>
      <label>Nombre<input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Tipo de trabajador<select value={type} onChange={(e) => choose(e.target.value as WorkerType)}><option value="day">Diurno</option><option value="night">Nocturno</option></select></label>
      <label>Horas por defecto<input type="number" step=".25" value={hours} onChange={(e) => setHours(+e.target.value)} /></label>
      <button className="primary full" disabled={!name.trim()} onClick={() => onSave(name.trim(), type, hours)}><Check />Guardar</button>
    </Modal>
  );
}

function MonthPicker({ date, close, onPick }: any) {
  const [month, setMonth] = useState(date.getMonth());
  const [year, setYear] = useState(date.getFullYear());
  const months = Array.from({ length: 12 }, (_, index) => format(new Date(minSelectableYear, index, 1), 'MMMM', { locale: es }));
  const years = Array.from({ length: 20 }, (_, index) => minSelectableYear + index);
  const safeYear = Math.max(minSelectableYear, year);

  return (
    <Modal close={close} className="picker">
      <p className="eyebrow">IR A FECHA</p>
      <h2>Mes y año</h2>
      <div className="wheels">
        <select value={month} onChange={(e) => setMonth(+e.target.value)}>{months.map((label, index) => <option value={index} key={label}>{label}</option>)}</select>
        <select value={safeYear} onChange={(e) => setYear(+e.target.value)}>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select>
      </div>
      <button className="primary full" onClick={() => onPick(new Date(safeYear, month, 1))}>Ver calendario</button>
    </Modal>
  );
}

function Workers({ workers, onEdit, onDelete, onAdd }: any) {
  return (
    <section className="view">
      <div className="intro"><p>Gestiona tu equipo y sus horarios habituales.</p><button className="primary" onClick={onAdd}><Plus />Nuevo</button></div>
      <div className="workers-list">{workers.map((worker: Worker) => <article className="worker" key={worker.id}><i style={{ background: worker.color }}>{worker.name[0]}</i><div><strong>{worker.name}</strong><span>{typeLabel(worker.type)} · {worker.defaultHours} h por defecto</span></div><button onClick={() => onEdit(worker)}><Pencil /></button><button onClick={() => onDelete(worker.id)}><Trash2 /></button></article>)}</div>
    </section>
  );
}

function HistoryView({ data }: any) {
  const [range, setRange] = useState<'week' | 'month' | 'year' | 'custom'>('month');
  const [from, setFrom] = useState(iso(startOfMonth(new Date())));
  const [to, setTo] = useState(iso(new Date()));
  const [active, setActive] = useState<Worker | null>(null);
  const now = new Date();
  const interval = range === 'week'
    ? { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) }
    : range === 'month'
      ? { start: startOfMonth(now), end: endOfMonth(now) }
      : range === 'year'
        ? { start: new Date(now.getFullYear(), 0, 1), end: new Date(now.getFullYear(), 11, 31) }
        : { start: new Date(from + 'T00:00:00'), end: new Date(to + 'T23:59:59') };

  return (
    <section className="view">
      <div className="segmented history-segment">{[['week', 'Semana'], ['month', 'Mes'], ['year', 'Año'], ['custom', 'Rango']].map(([id, label]) => <button key={id} className={range === id ? 'selected' : ''} onClick={() => setRange(id as any)}>{label}</button>)}</div>
      {range === 'custom' && <div className="range-inputs"><label>Desde<input type="date" min="2026-01-01" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>Hasta<input type="date" min="2026-01-01" value={to} onChange={(e) => setTo(e.target.value)} /></label></div>}
      <div className="history-list">{data.workers.map((worker: Worker) => <button key={worker.id} onClick={() => setActive(worker)}><i style={{ background: worker.color }} /><div><strong>{worker.name}</strong></div><ChevronRight /></button>)}</div>
      {active && <HistoryModal worker={active} assignments={data.assignments.filter((a: Assignment) => a.workerId === active.id && isWithinInterval(new Date(a.date + 'T12:00:00'), interval))} config={data.paymentConfig} close={() => setActive(null)} />}
    </section>
  );
}

function HistoryModal({ worker, assignments, config, close }: any) {
  const hours = assignments.reduce((total: number, a: Assignment) => total + a.workedHours, 0);
  const sorted = [...assignments].sort((a: Assignment, b: Assignment) => b.date.localeCompare(a.date));

  return (
    <Modal close={close} className="history-modal">
      <p className="eyebrow">HISTORIAL DE TRABAJADOR</p>
      <div className="person-title"><i style={{ background: worker.color }} />{worker.name}</div>
      <div className="metrics"><span>Tipo<h3>{typeLabel(worker.type)}</h3></span><span>Horas<h3>{hours} h</h3></span><span>Jornadas<h3>{assignments.length}</h3></span><span>Promedio<h3>{assignments.length ? (hours / assignments.length).toFixed(1) : 0} h</h3></span><span>Total<h3>{paymentService.money(paymentService.amount(hours, worker, config))}</h3></span></div>
      <h3>Registro cronológico</h3>
      <div className="chronology">{sorted.length ? sorted.map((a: Assignment) => <div key={a.id}><span>{format(new Date(a.date + 'T12:00:00'), 'dd/MM/yyyy')} · {a.workedHours} h</span><b>{paymentService.money(paymentService.amount(a.workedHours, worker, config))}</b></div>) : <p>Sin jornadas en este periodo.</p>}</div>
    </Modal>
  );
}

function SettingsView({ data, importRef, onToast, onImport, onPayments, onOpenExport }: any) {
  const [config, setConfig] = useState<PaymentConfig>(data.paymentConfig);
  useEffect(() => setConfig(data.paymentConfig), [data.paymentConfig]);

  const update = (type: WorkerType, key: keyof PaymentRule, value: number) => {
    const next = { ...config, [type]: { ...config[type], [key]: value } };
    setConfig(next);
    onPayments(next);
  };

  const read = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImport(getImported(JSON.parse(String(reader.result))));
        onToast('Copia restaurada');
      } catch {
        onToast('El archivo no es válido');
      }
    };
    reader.readAsText(file);
  };

  return (
    <section className="view">
      <div className="storage"><span>Almacenamiento utilizado</span><strong>{(new Blob([JSON.stringify(data)]).size / 1024).toFixed(1)} KB <small>de 5 MB</small></strong></div>
      <h3>Configuración de pagos</h3>
      <div className="payment-settings">{(['day', 'night'] as WorkerType[]).map((type) => <div className="payment-rule" key={type}><strong>{typeLabel(type)}</strong><label>Horas estándar<input type="number" min=".25" step=".25" value={config[type].standardHours} onChange={(e) => update(type, 'standardHours', +e.target.value)} /></label><label>Pago estándar (€)<input type="number" min="0" step=".01" value={config[type].standardPayment} onChange={(e) => update(type, 'standardPayment', +e.target.value)} /></label><small>Tarifa: {paymentService.money(paymentService.rate(config, type))}/hora</small></div>)}</div>
      <h3>Copias y exportación</h3>
      <div className="settings-list">
        <button onClick={() => onOpenExport('json')}><Download /><span>Exportar copia<small>JSON · Formato restaurable</small></span><ChevronRight /></button>
        <button onClick={() => onOpenExport('pdf')}><FileDown /><span>Exportar PDF<small>Informe de pagos imprimible</small></span><ChevronRight /></button>
        <button onClick={() => onOpenExport('excel')}><FileDown /><span>Exportar Excel<small>Informe de pagos por trabajador</small></span><ChevronRight /></button>
        <button onClick={() => onOpenExport('txt')}><FileDown /><span>Exportar TXT<small>Informe legible y limpio</small></span><ChevronRight /></button>
        <button onClick={() => importRef.current?.click()}><Upload /><span>Importar copia<small>Restaurar desde JSON</small></span><ChevronRight /></button>
        <input ref={importRef} type="file" accept="application/json" onChange={read} />
      </div>
    </section>
  );
}

function ExportDialog({ data, onClose, onAction }: any) {
  const [config, setConfig] = useState<ExportConfig>(defaultExportConfig(data));
  useEffect(() => setConfig(defaultExportConfig(data)), [data]);

  const selectedWorkers = data.workers.filter((worker: Worker) => config.workerIds.includes(worker.id));
  const allSelected = data.workers.length > 0 && config.workerIds.length === data.workers.length;
  const selectAll = () => setConfig((current) => ({ ...current, workerIds: data.workers.map((worker: Worker) => worker.id) }));
  const clearAll = () => setConfig((current) => ({ ...current, workerIds: [] }));
  const toggleWorker = (workerId: string) => setConfig((current) => ({
    ...current,
    workerIds: current.workerIds.includes(workerId)
      ? current.workerIds.filter((id) => id !== workerId)
      : [...current.workerIds, workerId],
  }));

  const commit = (action: ExportAction) => {
    if (!config.startDate || !config.endDate || !config.workerIds.length) return;
    onAction(action, config);
  };

  return (
    <Modal close={onClose} className="export-dialog">
      <p className="eyebrow">EXPORTAR</p>
      <h2>Configuración de exportación</h2>
      <div className="export-grid">
        <label>Desde<input type="date" min="2026-01-01" value={config.startDate} onChange={(e) => setConfig((current) => ({ ...current, startDate: e.target.value }))} /></label>
        <label>Hasta<input type="date" min="2026-01-01" value={config.endDate} onChange={(e) => setConfig((current) => ({ ...current, endDate: e.target.value }))} /></label>
      </div>
      <div className="export-worker-actions">
        <button type="button" className="secondary" onClick={selectAll}>Seleccionar todos</button>
        <button type="button" className="secondary" onClick={clearAll}>Deseleccionar todos</button>
      </div>
      <div className="export-worker-list">
        {data.workers.map((worker: Worker) => (
          <label key={worker.id} className="export-worker-item">
            <input type="checkbox" checked={config.workerIds.includes(worker.id)} onChange={() => toggleWorker(worker.id)} />
            <span className="swatch" style={{ background: worker.color }} />
            <span>{worker.name}</span>
          </label>
        ))}
      </div>
      <div className="export-actions">
        <button type="button" onClick={() => commit('preview')}>Preview</button>
        <button type="button" onClick={() => commit('share')}>Share</button>
        <button type="button" onClick={() => commit('pdf')}>Export PDF</button>
        <button type="button" onClick={() => commit('excel')}>Export Excel (.xlsx)</button>
        <button type="button" onClick={() => commit('txt')}>Export TXT</button>
        <button type="button" onClick={() => commit('json')}>Export JSON</button>
      </div>
      <div className="export-summary">
        <strong>{selectedWorkers.length} trabajadores</strong>
        <span>{formatRangeText(config.startDate || iso(new Date()), config.endDate || iso(new Date()))}</span>
      </div>
    </Modal>
  );
}

function PreviewModal({ title, content, onClose }: any) {
  return (
    <Modal close={onClose} className="preview-modal">
      <p className="eyebrow">PREVISUALIZACIÓN</p>
      <h2>{title}</h2>
      <pre>{content}</pre>
    </Modal>
  );
}

const getImported = (value: any): Data => {
  localStorage.setItem(key, JSON.stringify(value));
  return getData();
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
createRoot(document.getElementById('root')!).render(<App />);
