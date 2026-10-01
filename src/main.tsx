import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode, type TouchEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import {
  addDays, addMonths, addWeeks, addYears, eachDayOfInterval, endOfMonth, endOfWeek, endOfYear, format, getISOWeek, isSameMonth, startOfMonth, startOfWeek,
  startOfYear, subMonths,
} from 'date-fns';
import { es } from 'date-fns/locale';
import {
  AlertTriangle, Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, Eye, FileDown, History,
  Info, Minus, Pencil, Plus, Settings, Share2, Trash2, Upload, X,
} from 'lucide-react';
import {
  createId, loadData, nextWorkerColor, saveData, shiftIcons, storageLimitBytes, storageUsage, toCurrentData,
  type Assignment, type Data, type Shift, type Worker,
} from './model';
import {
  addAssignments, duplicateShiftMessage, formatHours, groupByDate, paymentService, paymentBreakdown, removeAssignment, updateAssignment, weeklyTotals,
  type AssignmentChanges, type NewShiftEntry,
} from './payment';
import {
  buildBackup, buildFileName, buildReport, buildReportText, createExportBlob, downloadBlob, formatDateText, formatRangeText, shareBlob,
  type ExportConfig, type ExportFormat,
} from './exports';
import './styles.css';

type Tab = 'calendar' | 'history' | 'settings';
type Toast = { message: string; tone: 'ok' | 'error' };
type ConfirmState = { title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void };
type AssignFlow = { worker: Worker; dates: string[] };
type ExportRequest = { format: ExportFormat; startDate?: string; endDate?: string };
type ExportRunner = (kind: ExportFormat, action: 'download' | 'share', config: ExportConfig) => void;

const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const toDate = (value: string) => new Date(`${value}T12:00:00`);
const longDate = (value: string) => format(toDate(value), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
const minSelectableYear = 2026;
const weekLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const reminderKey = 'montrack-export-reminder';
const workerKey = 'montrack-selected-worker';

// Accepts both "5,5" and "5.5", since Spanish keyboards use a comma for decimals.
const parseNumber = (value: string) => {
  const parsed = Number(value.replace(',', '.').trim());
  return value.trim() && Number.isFinite(parsed) ? parsed : NaN;
};
const numberText = (value: number) => String(value).replace('.', ',');
const hoursError = (value: number) =>
  !Number.isFinite(value) || value <= 0 ? 'Escribe un número de horas mayor que 0.' : value > 24 ? 'Un turno no puede tener más de 24 horas.' : '';
const shiftIcon = (data: Data, shiftId: string) => data.shifts.find((shift) => shift.id === shiftId)?.icon ?? '🕒';
const activeWorkers = (data: Data) => data.workers.filter((worker) => !worker.archived);
const activeShifts = (data: Data) => data.shifts.filter((shift) => shift.active);
const workerLabel = (worker?: Worker) => (worker ? `${worker.name}${worker.archived ? ' (eliminado)' : ''}` : 'Trabajador eliminado');
const readFlag = (name: string) => {
  try {
    return localStorage.getItem(name);
  } catch {
    return null;
  }
};
const writeFlag = (name: string, value: string) => {
  try {
    localStorage.setItem(name, value);
  } catch {
    // Only a convenience flag; losing it just falls back to the default.
  }
};

// Text size is a per-device preference: only text scales, buttons keep their large touch size.
const textSizeKey = 'montrack-text-size';
const textSizes = [
  { id: 'normal', label: 'Normal', scale: 1 },
  { id: 'medium', label: 'Mediano', scale: 0.9 },
  { id: 'small', label: 'Pequeño', scale: 0.8 },
] as const;
type TextSize = (typeof textSizes)[number]['id'];
const readTextSize = (): TextSize => textSizes.find((size) => size.id === readFlag(textSizeKey))?.id ?? 'normal';
const applyTextSize = (id: TextSize) => {
  const size = textSizes.find((entry) => entry.id === id) ?? textSizes[0];
  document.documentElement.style.setProperty('--text-scale', String(size.scale));
};

function App() {
  const [data, setData] = useState<Data>(() => loadData());
  const [tab, setTab] = useState<Tab>('calendar');
  const [cursor, setCursor] = useState(new Date());
  const [weekly, setWeekly] = useState(false);
  const [workerId, setWorkerId] = useState(() => readFlag(workerKey));
  const [dayFor, setDayFor] = useState<{ workerId: string; date: string } | null>(null);
  const [assignFlow, setAssignFlow] = useState<AssignFlow | null>(null);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(null);
  const [editingWorker, setEditingWorker] = useState<Worker | null | undefined>(undefined);
  const [editingShift, setEditingShift] = useState<Shift | null | undefined>(undefined);
  const [monthPicker, setMonthPicker] = useState(false);
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
  const [preview, setPreview] = useState<{ format: ExportFormat; config: ExportConfig } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [reminderDone, setReminderDone] = useState(() => readFlag(reminderKey));
  const [reminderLater, setReminderLater] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>(readTextSize);
  const saveFailed = useRef(false);

  useEffect(() => {
    const ok = saveData(data);
    if (!ok && !saveFailed.current) setToast({ message: 'No se pudo guardar: el almacenamiento está lleno. Exporta una copia.', tone: 'error' });
    saveFailed.current = !ok;
  }, [data]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const notify = (message: string, tone: Toast['tone'] = 'ok') => setToast({ message, tone });
  const workerOf = (id: string) => data.workers.find((entry) => entry.id === id);

  const previousMonth = subMonths(new Date(), 1);
  const previousMonthKey = format(previousMonth, 'yyyy-MM');
  const previousRange = { startDate: iso(startOfMonth(previousMonth)), endDate: iso(endOfMonth(previousMonth)) };
  const showReminder = !reminderLater && reminderDone !== previousMonthKey
    && data.assignments.some((item) => item.date >= previousRange.startDate && item.date <= previousRange.endDate);
  const markReminderDone = () => {
    writeFlag(reminderKey, previousMonthKey);
    setReminderDone(previousMonthKey);
  };

  // One worker is selected at a time and shared by Calendario and Historial (remembered on this device).
  const calendarWorkers = activeWorkers(data);
  const historyWorkers = data.workers.filter((worker) => !worker.archived || data.assignments.some((item) => item.workerId === worker.id));
  const calendarWorker = calendarWorkers.find((worker) => worker.id === workerId) ?? calendarWorkers[0];
  const historyWorker = historyWorkers.find((worker) => worker.id === workerId) ?? calendarWorker ?? historyWorkers[0];
  const selectWorker = (worker: Worker) => {
    setWorkerId(worker.id);
    writeFlag(workerKey, worker.id);
  };
  const dayWorker = dayFor ? workerOf(dayFor.workerId) : undefined;
  const addWorker = () => setEditingWorker(null);

  const saveAssignments = (workerId: string, dates: string[], entries: NewShiftEntry[]) => {
    const result = addAssignments(data, workerId, dates, entries);
    if (!result.created.length) return result.skipped ? duplicateShiftMessage : 'No se ha guardado ningún turno.';
    setData(result.data);
    setAssignFlow(null);
    setDayFor(null);
    const count = result.created.length;
    notify(`${count} ${count === 1 ? 'turno guardado' : 'turnos guardados'}${result.skipped ? ` · ${result.skipped} ya estaban asignados` : ''}`);
    return undefined;
  };

  const saveEditedAssignment = (id: string, changes: AssignmentChanges) => {
    const result = updateAssignment(data, id, changes);
    if (result.error) return result.error;
    setData(result.data);
    setEditingAssignment(null);
    notify('Cambios guardados');
    return undefined;
  };

  const askDeleteAssignment = (assignment: Assignment) => {
    setConfirm({
      title: '¿Eliminar este turno?',
      body: (
        <div className="confirm-detail">
          <strong>{workerLabel(workerOf(assignment.workerId))}</strong>
          <span>{longDate(assignment.date)}</span>
          <span>{assignment.shiftNameSnapshot} · {formatHours(assignment.hours)} · {paymentService.money(assignment.paymentSnapshot)}</span>
        </div>
      ),
      confirmLabel: 'Eliminar turno',
      onConfirm: () => {
        setData((current) => removeAssignment(current, assignment.id));
        setEditingAssignment(null);
        notify('Turno eliminado');
      },
    });
  };

  const saveWorker = (name: string) => {
    const id = editingWorker?.id ?? createId();
    setData((current) =>
      editingWorker
        ? { ...current, workers: current.workers.map((entry) => (entry.id === editingWorker.id ? { ...entry, name } : entry)) }
        : { ...current, workers: [...current.workers, { id, name, color: nextWorkerColor(current.workers) }] },
    );
    // A newly added worker becomes the one shown in the calendar.
    if (!editingWorker) {
      setWorkerId(id);
      writeFlag(workerKey, id);
    }
    setEditingWorker(undefined);
    notify('Trabajador guardado');
  };

  const askDeleteWorker = (worker: Worker) => {
    const records = data.assignments.filter((item) => item.workerId === worker.id).length;
    setConfirm({
      title: `¿Eliminar a ${worker.name}?`,
      body: records
        ? <p>Ya no aparecerá para asignar turnos. Sus {records} turnos registrados se conservan en el historial y en los informes.</p>
        : <p>Este trabajador no tiene turnos registrados.</p>,
      confirmLabel: 'Eliminar trabajador',
      onConfirm: () => {
        // Workers with history are archived rather than removed so their records are never lost.
        setData((current) => ({
          ...current,
          workers: current.assignments.some((item) => item.workerId === worker.id)
            ? current.workers.map((entry) => (entry.id === worker.id ? { ...entry, archived: true } : entry))
            : current.workers.filter((entry) => entry.id !== worker.id),
        }));
        notify('Trabajador eliminado');
      },
    });
  };

  const saveShift = (values: Pick<Shift, 'name' | 'defaultHours' | 'paymentAmount' | 'icon'>) => {
    setData((current) =>
      editingShift
        ? { ...current, shifts: current.shifts.map((entry) => (entry.id === editingShift.id ? { ...entry, ...values } : entry)) }
        : { ...current, shifts: [...current.shifts, { id: createId(), color: '#64748B', active: true, ...values }] },
    );
    setEditingShift(undefined);
    notify('Turno guardado');
  };

  const askDeleteShift = (shift: Shift) => {
    setConfirm({
      title: `¿Eliminar el turno «${shift.name}»?`,
      body: <p>Ya no aparecerá al asignar turnos nuevos. Los días ya registrados con este turno no cambian.</p>,
      confirmLabel: 'Eliminar turno',
      onConfirm: () => {
        // Deactivated, not removed: existing records keep pointing at it.
        setData((current) => ({ ...current, shifts: current.shifts.map((entry) => (entry.id === shift.id ? { ...entry, active: false } : entry)) }));
        setEditingShift(undefined);
        notify('Turno eliminado de la lista');
      },
    });
  };

  const runExport: ExportRunner = async (kind, action, config) => {
    try {
      const blob = createExportBlob(kind, data, config);
      const fileName = buildFileName(kind, config);
      if (action === 'share') {
        const result = await shareBlob(blob, fileName);
        if (result === 'cancelled') return;
        notify(result === 'shared' ? 'Archivo compartido' : 'Este dispositivo no permite compartir este archivo. Se ha descargado.');
      } else {
        downloadBlob(blob, fileName);
        notify('Archivo descargado');
      }
      if (config.startDate <= previousRange.startDate && config.endDate >= previousRange.endDate) markReminderDone();
      setExportRequest(null);
      setPreview(null);
    } catch {
      notify('No se pudo crear el archivo. Inténtalo de nuevo.', 'error');
    }
  };

  const importBackup = (value: unknown) => {
    let next: Data;
    try {
      next = toCurrentData(value);
    } catch {
      notify('El archivo no es una copia de Montrack válida.', 'error');
      return;
    }
    setConfirm({
      title: '¿Restaurar esta copia?',
      body: (
        <p>
          La copia tiene {activeWorkers(next).length} trabajadores, {activeShifts(next).length} tipos de turno y {next.assignments.length} turnos registrados.
          Sustituirá todos los datos actuales de este dispositivo.
        </p>
      ),
      confirmLabel: 'Restaurar copia',
      onConfirm: () => {
        setData(next);
        notify('Copia restaurada');
      },
    });
  };

  return (
    <main className="app">
      <h1 className="visually-hidden">Montrack</h1>
      {tab === 'calendar' && (
        <Calendar
          data={data}
          worker={calendarWorker}
          workers={calendarWorkers}
          onWorker={selectWorker}
          cursor={cursor}
          weekly={weekly}
          setWeekly={setWeekly}
          setCursor={setCursor}
          openDay={(worker, date) => setDayFor({ workerId: worker.id, date })}
          openMultiDay={(worker) => setAssignFlow({ worker, dates: [] })}
          openPicker={() => setMonthPicker(true)}
          onAddWorker={addWorker}
          banner={showReminder && (
            <div className="banner" role="region" aria-label="Recordatorio">
              <Bell aria-hidden="true" />
              <div>
                <strong>¿Has guardado el mes de {format(previousMonth, 'MMMM', { locale: es })}?</strong>
                <p>Te recomendamos exportar los turnos del mes pasado.</p>
                <div className="banner-actions">
                  <button className="primary" onClick={() => setExportRequest({ format: 'pdf', ...previousRange })}>Exportar ahora</button>
                  <button className="secondary" onClick={markReminderDone}>Ya lo exporté</button>
                  <button className="secondary" onClick={() => setReminderLater(true)}>Más tarde</button>
                </div>
              </div>
            </div>
          )}
          storageWarning={storageUsage(data) > storageLimitBytes * 0.8}
        />
      )}
      {tab === 'history' && (
        <HistoryView
          data={data}
          worker={historyWorker}
          workers={historyWorkers}
          onWorker={selectWorker}
          openDay={(worker, date) => setDayFor({ workerId: worker.id, date })}
        />
      )}
      {tab === 'settings' && (
        <SettingsView
          data={data}
          workers={<Workers data={data} onEdit={setEditingWorker} onDelete={askDeleteWorker} onAdd={addWorker} />}
          onEditShift={setEditingShift}
          onAddShift={() => setEditingShift(null)}
          onOpenExport={(kind) => setExportRequest({ format: kind })}
          onImport={importBackup}
          onInvalidFile={() => notify('No se pudo leer el archivo.', 'error')}
          textSize={textSize}
          onTextSize={(id) => {
            setTextSize(id);
            applyTextSize(id);
            writeFlag(textSizeKey, id);
            notify(`Tamaño del texto: ${textSizes.find((size) => size.id === id)?.label}`);
          }}
        />
      )}
      <nav aria-label="Secciones">
        {([['calendar', CalendarDays, 'Calendario'], ['history', History, 'Historial'], ['settings', Settings, 'Ajustes']] as const).map(([id, Icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {dayFor && dayWorker && (
        <WorkerDayDialog
          key={`${dayFor.workerId}-${dayFor.date}`}
          data={data}
          worker={dayWorker}
          date={dayFor.date}
          close={() => setDayFor(null)}
          onSave={saveAssignments}
          onEdit={setEditingAssignment}
          onDelete={askDeleteAssignment}
        />
      )}
      {assignFlow && <AssignModal data={data} flow={assignFlow} close={() => setAssignFlow(null)} onSave={saveAssignments} />}
      {editingAssignment && (
        <AssignmentEditor
          data={data}
          assignment={editingAssignment}
          close={() => setEditingAssignment(null)}
          onSave={saveEditedAssignment}
          onDelete={askDeleteAssignment}
        />
      )}
      {editingWorker !== undefined && <WorkerModal worker={editingWorker} workers={data.workers} close={() => setEditingWorker(undefined)} onSave={saveWorker} />}
      {editingShift !== undefined && (
        <ShiftModal
          shift={editingShift}
          shifts={data.shifts}
          close={() => setEditingShift(undefined)}
          onSave={saveShift}
          onDelete={editingShift && activeShifts(data).length > 1 ? () => askDeleteShift(editingShift) : undefined}
        />
      )}
      {monthPicker && <MonthPicker date={cursor} close={() => setMonthPicker(false)} onPick={(date) => { setCursor(date); setMonthPicker(false); }} />}
      {exportRequest && (
        <ExportDialog
          data={data}
          request={exportRequest}
          onClose={() => setExportRequest(null)}
          onPreview={(kind, config) => setPreview({ format: kind, config })}
          onRun={runExport}
        />
      )}
      {preview && <PreviewModal data={data} format={preview.format} config={preview.config} onClose={() => setPreview(null)} onRun={runExport} />}
      {confirm && <ConfirmDialog state={confirm} close={() => setConfirm(null)} onConfirm={() => { confirm.onConfirm(); setConfirm(null); }} />}
      {toast && (
        <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
          {toast.tone === 'error' ? <AlertTriangle aria-hidden="true" /> : <Check aria-hidden="true" />}
          {toast.message}
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Dialogs: they can stack; Escape closes only the top one and keyboard focus stays inside it.

const modalStack: object[] = [];

function Modal({ children, close, className = '', title, eyebrow }: { children: ReactNode; close: () => void; className?: string; title: ReactNode; eyebrow?: string }) {
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const entry = {};
    modalStack.push(entry);
    const previous = document.activeElement as HTMLElement | null;
    const section = sectionRef.current;
    if (section && !section.contains(document.activeElement)) section.focus();
    const onKey = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== entry || !section) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...section.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [href]')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === section)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(entry), 1);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section ref={sectionRef} className={'modal ' + className} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <button className="close" onClick={close}><X aria-hidden="true" /><span>Cerrar</span></button>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={titleId}>{title}</h2>
        {children}
      </section>
    </div>
  );
}

function ConfirmDialog({ state, close, onConfirm }: { state: ConfirmState; close: () => void; onConfirm: () => void }) {
  return (
    <Modal close={close} title={state.title} className="confirm-modal">
      <div className="confirm-body">{state.body}</div>
      <div className="button-row">
        <button className="secondary big" onClick={close} autoFocus>Cancelar</button>
        <button className="danger big" onClick={onConfirm}><Trash2 aria-hidden="true" />{state.confirmLabel}</button>
      </div>
    </Modal>
  );
}

function HoursInput({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId();
  const step = (delta: number) => {
    const current = parseNumber(value);
    onChange(numberText(Math.min(24, Math.max(0.5, (Number.isFinite(current) ? current : 0) + delta))));
  };
  return (
    <div className="hours-input">
      <label htmlFor={id}>{label}</label>
      <div>
        <button type="button" className="step" onClick={() => step(-0.5)} aria-label={`${label}: quitar media hora`}><Minus aria-hidden="true" /></button>
        <input id={id} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />
        <span aria-hidden="true">h</span>
        <button type="button" className="step" onClick={() => step(0.5)} aria-label={`${label}: añadir media hora`}><Plus aria-hidden="true" /></button>
      </div>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return message ? <p className="form-error" role="alert"><AlertTriangle aria-hidden="true" />{message}</p> : null;
}

// ---------------------------------------------------------------------------
// One worker at a time: the selector, the swipe gesture and the calendar grid shared by Calendario and Historial

const weekOptions = { weekStartsOn: 1 } as const;
const countText = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;

// Short labels for small calendar cells (M, T, N…); a second letter is added only when two names would clash.
const abbreviations = (names: string[]) => {
  const unique = [...new Set(names)];
  return new Map(unique.map((name) => {
    const clash = unique.some((other) => other !== name && other[0]?.toUpperCase() === name[0]?.toUpperCase());
    return [name, (clash ? name.slice(0, 2) : name.slice(0, 1)).toUpperCase()];
  }));
};

/**
 * A clearly horizontal finger movement switches worker. Vertical scrolling, slow drags and two-finger
 * gestures are ignored, so reading the calendar never changes worker by accident.
 */
function useSwipe(onSwipe: (direction: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  return {
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const touch = event.touches[0];
      start.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const begin = start.current;
      start.current = null;
      if (!begin) return;
      const touch = event.changedTouches[0];
      const dx = touch.clientX - begin.x;
      const dy = touch.clientY - begin.y;
      if (Math.abs(dx) >= 70 && Math.abs(dx) > Math.abs(dy) * 2 && Date.now() - begin.time < 800) onSwipe(dx < 0 ? 1 : -1);
    },
    onTouchCancel: () => { start.current = null; },
  };
}

function WorkerSwitcher({ workers, worker, onSelect, onAddWorker }: { workers: Worker[]; worker: Worker; onSelect: (worker: Worker) => void; onAddWorker?: () => void }) {
  const [listOpen, setListOpen] = useState(false);
  const index = Math.max(0, workers.findIndex((entry) => entry.id === worker.id));
  const go = (delta: number) => onSelect(workers[(index + delta + workers.length) % workers.length]);
  const single = workers.length < 2;
  return (
    <div className="worker-switcher">
      <button className="switch-arrow" onClick={() => go(-1)} disabled={single} aria-label="Trabajador anterior"><ChevronLeft aria-hidden="true" /></button>
      <button className="worker-name" onClick={() => setListOpen(true)} aria-label={`Trabajador: ${worker.name}. Toca para elegir otro`}>
        <i style={{ background: worker.color }} aria-hidden="true" />
        <span>{workerLabel(worker)}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      <button className="switch-arrow" onClick={() => go(1)} disabled={single} aria-label="Trabajador siguiente"><ChevronRight aria-hidden="true" /></button>
      {listOpen && (
        <Modal close={() => setListOpen(false)} eyebrow="TRABAJADORES" title="Elegir trabajador">
          <div className="worker-picker">
            {workers.map((entry) => (
              <button key={entry.id} className={entry.id === worker.id ? 'current' : ''} aria-current={entry.id === worker.id || undefined} onClick={() => { onSelect(entry); setListOpen(false); }}>
                <i style={{ background: entry.color }} aria-hidden="true" />
                <span>{workerLabel(entry)}</span>
                {entry.id === worker.id ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
              </button>
            ))}
          </div>
          {onAddWorker && <button className="secondary full" onClick={() => { setListOpen(false); onAddWorker(); }}><Plus aria-hidden="true" />Agregar trabajador</button>}
        </Modal>
      )}
    </div>
  );
}

/**
 * The calendar of one worker, read straight from the saved assignments (the single source of truth).
 * Every shift of a day is shown: full names on wider screens, short letters plus a key on phones.
 */
function WorkerDays({ data, worker, days, month, isEnabled, onDay }: {
  data: Data; worker: Worker; days: Date[]; month?: Date; isEnabled?: (date: string) => boolean; onDay: (date: string) => void;
}) {
  const first = iso(days[0]);
  const last = iso(days[days.length - 1]);
  const grouped = groupByDate(data, data.assignments.filter((item) => item.workerId === worker.id && item.date >= first && item.date <= last));
  const byDate = new Map(grouped.map((day) => [day.date, day]));
  const abbr = abbreviations(grouped.flatMap((day) => day.items.map((item) => item.shiftNameSnapshot)));
  const today = iso(new Date());
  return (
    <>
      <div className="week-labels" aria-hidden="true">{weekLabels.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="personal-days">
        {days.map((date) => {
          const key = iso(date);
          if (month && !isSameMonth(date, month)) return <span key={key} className="pday blank" aria-hidden="true" />;
          const day = byDate.get(key);
          const what = day ? `${day.items.map((item) => item.shiftNameSnapshot).join(' y ')}, ${paymentService.money(day.total)}` : 'sin turnos';
          return (
            <button
              key={key}
              className={'pday' + (day ? ' worked' : '') + (key === today ? ' today' : '')}
              disabled={isEnabled ? !isEnabled(key) : false}
              onClick={() => onDay(key)}
              aria-label={`${format(date, "EEEE d 'de' MMMM", { locale: es })}${key === today ? ', hoy' : ''}: ${what}`}
            >
              <span className="pday-number">{format(date, 'd')}</span>
              {day?.items.map((item) => (
                <span key={item.id} className="pshift" aria-hidden="true">
                  <span className="full-name">{item.shiftNameSnapshot}</span>
                  <span className="abbr">{abbr.get(item.shiftNameSnapshot)}</span>
                </span>
              ))}
            </button>
          );
        })}
      </div>
      {abbr.size > 0 && <p className="shift-legend">{[...abbr].map(([name, short]) => `${short} = ${name}`).join(' · ')}</p>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Calendar

function Calendar({ data, worker, workers, onWorker, cursor, weekly, setWeekly, setCursor, openDay, openMultiDay, openPicker, onAddWorker, banner, storageWarning }: {
  data: Data; worker?: Worker; workers: Worker[]; onWorker: (worker: Worker) => void; cursor: Date; weekly: boolean; setWeekly: (value: boolean) => void;
  setCursor: (date: Date) => void; openDay: (worker: Worker, date: string) => void; openMultiDay: (worker: Worker) => void; openPicker: () => void;
  onAddWorker: () => void; banner: ReactNode; storageWarning: boolean;
}) {
  const today = new Date();
  const start = weekly ? startOfWeek(cursor, weekOptions) : startOfWeek(startOfMonth(cursor), weekOptions);
  const end = weekly ? endOfWeek(cursor, weekOptions) : endOfWeek(endOfMonth(cursor), weekOptions);
  const days = eachDayOfInterval({ start, end });
  const notCurrent = weekly ? iso(start) !== iso(startOfWeek(today, weekOptions)) : !isSameMonth(cursor, today);
  const unit = weekly ? 'Semana' : 'Mes';
  const swipe = useSwipe((direction) => {
    if (!worker || workers.length < 2) return;
    const index = workers.findIndex((entry) => entry.id === worker.id);
    onWorker(workers[(index + direction + workers.length) % workers.length]);
  });

  return (
    <section className="view">
      {banner}
      {storageWarning && <div className="banner warning" role="alert"><AlertTriangle aria-hidden="true" /><div><strong>El almacenamiento está casi lleno.</strong><p>Haz una copia de seguridad desde Ajustes.</p></div></div>}
      {worker ? (
        <>
          <WorkerSwitcher workers={workers} worker={worker} onSelect={onWorker} onAddWorker={onAddWorker} />
          <div className="month-nav">
            <button onClick={() => setCursor(weekly ? addDays(cursor, -7) : subMonths(cursor, 1))} aria-label={`${unit} anterior`}><ChevronLeft aria-hidden="true" /></button>
            <button className="month-title" onClick={openPicker} aria-label={`Elegir mes y año. Ahora: ${format(cursor, 'MMMM yyyy', { locale: es })}`}>
              {format(cursor, 'MMMM yyyy', { locale: es })}<ChevronDown aria-hidden="true" />
            </button>
            <button onClick={() => setCursor(weekly ? addDays(cursor, 7) : addMonths(cursor, 1))} aria-label={`${unit} siguiente`}><ChevronRight aria-hidden="true" /></button>
          </div>
          <div className="calendar-card personal-calendar" {...swipe}>
            <WorkerDays data={data} worker={worker} days={days} month={weekly ? undefined : cursor} onDay={(date) => openDay(worker, date)} />
          </div>
          {notCurrent && <button className="back-today" onClick={() => setCursor(today)}><Clock3 aria-hidden="true" />Volver a hoy</button>}
          <div className="calendar-tools">
            <div className="segmented" role="group" aria-label="Tipo de vista">
              <button className={!weekly ? 'selected' : ''} aria-pressed={!weekly} onClick={() => setWeekly(false)}>Mes</button>
              <button className={weekly ? 'selected' : ''} aria-pressed={weekly} onClick={() => setWeekly(true)}>Semana</button>
            </div>
            {!worker.archived && (
              <button className="secondary" onClick={() => openMultiDay(worker)}><CalendarDays aria-hidden="true" />Asignar varios días</button>
            )}
          </div>
        </>
      ) : (
        <div className="empty-card">
          <p>Todavía no hay trabajadores.</p>
          <button className="primary" onClick={onAddWorker}><Plus aria-hidden="true" />Agregar trabajador</button>
        </div>
      )}
    </section>
  );
}

// Date picker for assigning several days at once; it also shows the shifts the worker already has.
function MiniCalendar({ data, worker, selected, onToggle, initialMonth }: { data: Data; worker: Worker; selected: string[]; onToggle: (date: string) => void; initialMonth: Date }) {
  const [month, setMonth] = useState(startOfMonth(initialMonth));
  const days = eachDayOfInterval({ start: startOfWeek(month, weekOptions), end: endOfWeek(endOfMonth(month), weekOptions) });
  const existing = groupByDate(data, data.assignments.filter((item) => item.workerId === worker.id && item.date >= iso(days[0]) && item.date <= iso(days[days.length - 1])));
  const abbr = abbreviations(existing.flatMap((day) => day.items.map((item) => item.shiftNameSnapshot)));
  const byDate = new Map(existing.map((day) => [day.date, day.items]));
  return (
    <div className="mini-calendar">
      <div className="mini-nav">
        <button type="button" onClick={() => setMonth(subMonths(month, 1))} aria-label="Mes anterior"><ChevronLeft aria-hidden="true" /></button>
        <strong>{format(month, 'MMMM yyyy', { locale: es })}</strong>
        <button type="button" onClick={() => setMonth(addMonths(month, 1))} aria-label="Mes siguiente"><ChevronRight aria-hidden="true" /></button>
      </div>
      <div className="mini-grid" aria-hidden="true">{weekLabels.map((label) => <span key={label}>{label}</span>)}</div>
      <div className="mini-grid">
        {days.map((date) => {
          const key = iso(date);
          const picked = selected.includes(key);
          const has = byDate.get(key) ?? [];
          return (
            <button
              type="button"
              key={key}
              onClick={() => onToggle(key)}
              aria-pressed={picked}
              aria-label={`${format(date, "EEEE d 'de' MMMM", { locale: es })}${has.length ? `. Ya tiene: ${has.map((item) => item.shiftNameSnapshot).join(' y ')}` : ''}`}
              className={(isSameMonth(date, month) ? '' : 'muted ') + (picked ? 'picked ' : '') + (has.length ? 'has' : '')}
            >
              {format(date, 'd')}
              {has.length > 0 && <small aria-hidden="true">{has.map((item) => abbr.get(item.shiftNameSnapshot)).join('·')}</small>}
            </button>
          );
        })}
      </div>
      {abbr.size > 0 && <p className="shift-legend always">{[...abbr].map(([name, short]) => `${short} = ${name}`).join(' · ')}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One worker's day: what they already have (edit / delete) and the shifts that can still be added

// One shift line with its own Edit and (deliberately smaller) Delete actions.
function ShiftRow({ data, item, worker, onEdit, onDelete }: {
  data: Data; item: Assignment; worker: Worker; onEdit: (item: Assignment) => void; onDelete: (item: Assignment) => void;
}) {
  return (
    <li className="shift-row">
      <div className="shift-info">
        <span className="shift-icon" aria-hidden="true">{shiftIcon(data, item.shiftId)}</span>
        <strong>{item.shiftNameSnapshot}</strong>
        <span>{formatHours(item.hours)} · {paymentService.money(item.paymentSnapshot)}</span>
      </div>
      <div className="row-actions">
        <button className="secondary" onClick={() => onEdit(item)} aria-label={`Editar turno de ${item.shiftNameSnapshot} de ${worker.name}`}>
          <Pencil aria-hidden="true" />Editar
        </button>
        <button className="danger-outline small" onClick={() => onDelete(item)} aria-label={`Eliminar turno de ${item.shiftNameSnapshot} de ${worker.name}`}>
          <Trash2 aria-hidden="true" />Eliminar
        </button>
      </div>
    </li>
  );
}

function WorkerDayDialog({ data, worker, date, close, onSave, onEdit, onDelete }: {
  data: Data; worker: Worker; date: string; close: () => void; onSave: (workerId: string, dates: string[], entries: NewShiftEntry[]) => string | undefined;
  onEdit: (item: Assignment) => void; onDelete: (item: Assignment) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const day = groupByDate(data, data.assignments.filter((item) => item.workerId === worker.id && item.date === date))[0];
  const current = day?.items ?? [];
  const available = worker.archived ? [] : activeShifts(data).filter((shift) => !current.some((item) => item.shiftId === shift.id));
  const chosen = selected.filter((id) => available.some((shift) => shift.id === id));

  const toggle = (id: string) => {
    setError('');
    setSelected((list) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]));
  };
  const save = () => {
    if (!chosen.length) return setError('Selecciona al menos un turno.');
    // Normal shifts use the hours configured in Ajustes; an exceptional day is corrected afterwards with "Editar".
    const result = onSave(worker.id, [date], available.filter((shift) => chosen.includes(shift.id)).map((shift) => ({ shiftId: shift.id, hours: shift.defaultHours })));
    if (result) setError(result);
  };

  return (
    <Modal close={close} className="worker-day-dialog" eyebrow={workerLabel(worker).toUpperCase()} title={longDate(date)}>
      {current.length > 0 && (
        <section className="day-worker worker-day" aria-label="Ya tiene">
          <h3>Ya tiene</h3>
          <ul>{current.map((item) => <ShiftRow key={item.id} data={data} item={item} worker={worker} onEdit={onEdit} onDelete={onDelete} />)}</ul>
          <p className="day-total"><span>Total del día</span><strong>{paymentService.money(day.total)}</strong></p>
        </section>
      )}
      {available.length > 0 ? (
        <>
          <fieldset className="shift-options">
            <legend>{current.length ? 'Añadir otro turno' : '¿Qué turno ha hecho?'}</legend>
            {available.map((shift) => {
              const checked = selected.includes(shift.id);
              return (
                <div key={shift.id} className={'shift-option' + (checked ? ' checked' : '')}>
                  <label>
                    <input type="checkbox" checked={checked} onChange={() => toggle(shift.id)} />
                    <span className="shift-icon" aria-hidden="true">{shift.icon}</span>
                    <span className="shift-text"><strong>{shift.name}</strong><small>{paymentService.money(shift.paymentAmount)}</small></span>
                  </label>
                </div>
              );
            })}
          </fieldset>
          <FormError message={error} />
          <button className="primary full" onClick={save}>
            <Check aria-hidden="true" />{chosen.length > 1 ? `Guardar ${chosen.length} turnos` : 'Guardar'}
          </button>
        </>
      ) : !worker.archived && <p className="hint all-assigned">Ya tiene todos los turnos este día.</p>}
    </Modal>
  );
}

function AssignModal({ data, flow, close, onSave }: {
  data: Data; flow: AssignFlow; close: () => void; onSave: (workerId: string, dates: string[], entries: NewShiftEntry[]) => string | undefined;
}) {
  const shifts = activeShifts(data);
  const { worker } = flow;
  const [dates, setDates] = useState<string[]>(flow.dates);
  const [chooseDates, setChooseDates] = useState(!flow.dates.length);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const sortedDates = [...dates].sort();
  // With a single day, the shifts the worker already has that day are listed and shown ticked; the others can be added.
  const current = dates.length === 1
    ? groupByDate(data, data.assignments.filter((item) => item.workerId === worker.id && item.date === dates[0]))[0]?.items ?? []
    : [];
  const existing = new Set(current.map((item) => item.shiftId));
  const chosen = selected.filter((id) => !existing.has(id));

  const toggleShift = (id: string) => {
    if (existing.has(id)) return setError(duplicateShiftMessage);
    setError('');
    setSelected((list) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]));
  };
  const toggleDate = (date: string) => {
    setError('');
    setDates((current) => (current.includes(date) ? current.filter((entry) => entry !== date) : [...current, date]));
  };
  const save = () => {
    if (!dates.length) return setError('Elige al menos un día.');
    if (!chosen.length) return setError(existing.size ? 'Elige otro turno para añadir.' : 'Selecciona al menos un turno.');
    // Normal shifts use the hours configured in Ajustes; an exceptional day is corrected afterwards with "Editar".
    const entries = chosen.flatMap((id) => {
      const shift = shifts.find((entry) => entry.id === id);
      return shift ? [{ shiftId: id, hours: shift.defaultHours }] : [];
    });
    const result = onSave(worker.id, sortedDates, entries);
    if (result) setError(result);
  };

  return (
    <Modal close={close} className="assignment-modal" eyebrow="AÑADIR TURNOS" title={<span className="person-title"><i style={{ background: worker.color }} aria-hidden="true" />{worker.name}</span>}>
      <div className="dates-summary">
        <CalendarDays aria-hidden="true" />
        <div>
          <strong>{dates.length === 0 ? 'Ningún día elegido' : dates.length === 1 ? longDate(dates[0]) : `${dates.length} días elegidos`}</strong>
          {dates.length > 1 && <small>{sortedDates.slice(0, 6).map((date) => format(toDate(date), 'dd/MM')).join(', ')}{dates.length > 6 ? '…' : ''}</small>}
        </div>
        <button type="button" className="secondary" onClick={() => setChooseDates(!chooseDates)} aria-expanded={chooseDates}>
          {chooseDates ? 'Ocultar calendario' : 'Elegir más días'}
        </button>
      </div>
      {chooseDates && <MiniCalendar data={data} worker={worker} selected={dates} onToggle={toggleDate} initialMonth={dates.length ? toDate(sortedDates[0]) : new Date()} />}

      {current.length > 0 && (
        <div className="current-shifts">
          <strong>Ya tiene este día:</strong>
          <span>{current.map((item) => `${shiftIcon(data, item.shiftId)} ${item.shiftNameSnapshot}`).join(' · ')}</span>
        </div>
      )}
      <fieldset className="shift-options">
        <legend>{current.length ? '¿Qué turno quieres añadir?' : '¿Qué turno realizará?'}</legend>
        <p className="hint">Puedes marcar uno o varios turnos.</p>
        {shifts.map((shift) => {
          const already = existing.has(shift.id);
          const checked = already || selected.includes(shift.id);
          return (
            <div key={shift.id} className={'shift-option' + (checked ? ' checked' : '') + (already ? ' already' : '')}>
              <label>
                <input type="checkbox" checked={checked} aria-disabled={already || undefined} onChange={() => toggleShift(shift.id)} />
                <span className="shift-icon" aria-hidden="true">{shift.icon}</span>
                <span className="shift-text">
                  <strong>{shift.name}</strong>
                  <small>{already ? 'Ya asignado este día' : paymentService.money(shift.paymentAmount)}</small>
                </span>
              </label>
            </div>
          );
        })}
      </fieldset>
      <FormError message={error} />
      <button className="primary full" onClick={save}>
        <Check aria-hidden="true" />
        {chosen.length && dates.length > 1 ? `Guardar turnos (${chosen.length * dates.length})` : 'Guardar turnos'}
      </button>
    </Modal>
  );
}

function AssignmentEditor({ data, assignment, close, onSave, onDelete }: {
  data: Data; assignment: Assignment; close: () => void; onSave: (id: string, changes: AssignmentChanges) => string | undefined; onDelete: (item: Assignment) => void;
}) {
  const [workerId, setWorkerId] = useState(assignment.workerId);
  const [date, setDate] = useState(assignment.date);
  const [shiftId, setShiftId] = useState(assignment.shiftId);
  const [hours, setHours] = useState(numberText(assignment.hours));
  const [error, setError] = useState('');
  const workers = data.workers.filter((worker) => !worker.archived || worker.id === assignment.workerId);
  const shifts = data.shifts.filter((shift) => shift.active && shift.id !== assignment.shiftId);
  const newShift = shiftId !== assignment.shiftId ? data.shifts.find((shift) => shift.id === shiftId) : undefined;
  const payment = newShift ? newShift.paymentAmount : assignment.paymentSnapshot;
  const change = (setter: (value: string) => void) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setError('');
    setter(event.target.value);
  };

  const save = () => {
    const parsed = parseNumber(hours);
    if (hoursError(parsed)) return setError(hoursError(parsed));
    if (!date) return setError('Elige una fecha.');
    const result = onSave(assignment.id, { workerId, date, shiftId, hours: parsed });
    if (result) setError(result);
  };

  return (
    <Modal close={close} eyebrow="EDITAR TURNO" title={`${assignment.shiftNameSnapshot} · ${formatDateText(assignment.date)}`}>
      <label>Trabajador
        <select value={workerId} onChange={change(setWorkerId)}>
          {workers.map((worker) => <option key={worker.id} value={worker.id}>{workerLabel(worker)}</option>)}
        </select>
      </label>
      <label>Fecha<input type="date" value={date} onChange={change(setDate)} /></label>
      <label>Turno
        <select value={shiftId} onChange={change(setShiftId)}>
          <option value={assignment.shiftId}>{assignment.shiftNameSnapshot} (actual)</option>
          {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
        </select>
      </label>
      <HoursInput label="Horas (solo si fueron distintas de lo habitual)" value={hours} onChange={(value) => { setError(''); setHours(value); }} />
      <p className="payment-note">
        Pago de este turno: <strong>{paymentService.money(payment)}</strong>
        <small>{newShift ? `Se usará el pago actual del turno «${newShift.name}».` : 'Se mantiene el pago con el que se registró.'}</small>
      </p>
      <FormError message={error} />
      <div className="button-row">
        <button className="secondary big" onClick={close}>Cancelar</button>
        <button className="primary big" onClick={save}><Check aria-hidden="true" />Guardar</button>
      </div>
      <div className="secondary-actions">
        <button className="danger-outline small" onClick={() => onDelete(assignment)}><Trash2 aria-hidden="true" />Eliminar turno</button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Workers, shifts and month picker

function WorkerModal({ worker, workers, close, onSave }: { worker: Worker | null; workers: Worker[]; close: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(worker?.name || '');
  const [error, setError] = useState('');
  const color = worker?.color ?? nextWorkerColor(workers);
  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('Escribe el nombre del trabajador.');
    if (workers.some((entry) => !entry.archived && entry.id !== worker?.id && entry.name.trim().toLowerCase() === trimmed.toLowerCase())) {
      return setError('Ya existe un trabajador con ese nombre.');
    }
    onSave(trimmed);
  };
  return (
    <Modal close={close} eyebrow={worker ? 'EDITAR TRABAJADOR' : 'NUEVO TRABAJADOR'} title={worker ? 'Actualizar trabajador' : 'Agregar trabajador'}>
      <label>Nombre<input autoFocus value={name} onChange={(event) => { setError(''); setName(event.target.value); }} onKeyDown={(event) => { if (event.key === 'Enter') save(); }} /></label>
      <p className="color-preview"><i style={{ background: color }} aria-hidden="true" />Color asignado</p>
      <FormError message={error} />
      <div className="button-row">
        <button className="secondary big" onClick={close}>Cancelar</button>
        <button className="primary big" onClick={save}><Check aria-hidden="true" />Guardar</button>
      </div>
    </Modal>
  );
}

function ShiftModal({ shift, shifts, close, onSave, onDelete }: {
  shift: Shift | null; shifts: Shift[]; close: () => void; onSave: (values: Pick<Shift, 'name' | 'defaultHours' | 'paymentAmount' | 'icon'>) => void; onDelete?: () => void;
}) {
  const [name, setName] = useState(shift?.name ?? '');
  const [hours, setHours] = useState(shift ? numberText(shift.defaultHours) : '');
  const [payment, setPayment] = useState(shift ? numberText(shift.paymentAmount) : '');
  const [icon, setIcon] = useState(shift?.icon ?? '⭐');
  const [error, setError] = useState('');

  const save = () => {
    const trimmed = name.trim();
    const parsedHours = parseNumber(hours);
    const parsedPayment = parseNumber(payment);
    if (!trimmed) return setError('Escribe el nombre del turno.');
    if (shifts.some((entry) => entry.active && entry.id !== shift?.id && entry.name.trim().toLowerCase() === trimmed.toLowerCase())) return setError('Ya existe un turno con ese nombre.');
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) return setError('Las horas deben ser mayores que 0.');
    if (parsedHours > 24) return setError('Un turno no puede tener más de 24 horas.');
    if (!Number.isFinite(parsedPayment)) return setError('Escribe el pago del turno.');
    if (parsedPayment < 0) return setError('El pago no puede ser negativo.');
    onSave({ name: trimmed, defaultHours: parsedHours, paymentAmount: Math.round(parsedPayment * 100) / 100, icon });
  };

  return (
    <Modal close={close} eyebrow="CONFIGURACIÓN DE TURNOS" title={shift ? `Editar «${shift.name}»` : 'Añadir turno'}>
      <label>Nombre del turno<input autoFocus={!shift} value={name} onChange={(event) => { setError(''); setName(event.target.value); }} placeholder="Por ejemplo: Festivo" /></label>
      <label>Horas<input inputMode="decimal" value={hours} onChange={(event) => { setError(''); setHours(event.target.value); }} placeholder="6" /></label>
      <label>Pago (€)<input inputMode="decimal" value={payment} onChange={(event) => { setError(''); setPayment(event.target.value); }} placeholder="30" /></label>
      <fieldset className="icon-picker">
        <legend>Símbolo</legend>
        {shiftIcons.map((entry) => (
          <button type="button" key={entry} className={icon === entry ? 'picked' : ''} aria-pressed={icon === entry} aria-label={`Símbolo ${entry}`} onClick={() => setIcon(entry)}>{entry}</button>
        ))}
      </fieldset>
      {shift && <p className="hint">Los cambios solo se aplican a los turnos nuevos. Los días ya registrados no cambian.</p>}
      <FormError message={error} />
      <div className="button-row">
        <button className="secondary big" onClick={close}>Cancelar</button>
        <button className="primary big" onClick={save}><Check aria-hidden="true" />Guardar</button>
      </div>
      {onDelete && <div className="secondary-actions"><button className="danger-outline small" onClick={onDelete}><Trash2 aria-hidden="true" />Eliminar turno</button></div>}
    </Modal>
  );
}

function MonthPicker({ date, close, onPick }: { date: Date; close: () => void; onPick: (date: Date) => void }) {
  const [month, setMonth] = useState(date.getMonth());
  const [year, setYear] = useState(Math.max(minSelectableYear, date.getFullYear()));
  const months = Array.from({ length: 12 }, (_, index) => format(new Date(minSelectableYear, index, 1), 'MMMM', { locale: es }));
  const years = Array.from({ length: 20 }, (_, index) => minSelectableYear + index);

  return (
    <Modal close={close} className="picker" eyebrow="IR A FECHA" title="Mes y año">
      <div className="wheels">
        <label>Mes<select value={month} onChange={(event) => setMonth(+event.target.value)}>{months.map((label, index) => <option value={index} key={label}>{label}</option>)}</select></label>
        <label>Año<select value={year} onChange={(event) => setYear(+event.target.value)}>{years.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <button className="primary full" onClick={() => onPick(new Date(year, month, 1))}>Ver calendario</button>
    </Modal>
  );
}

function Workers({ data, onEdit, onDelete, onAdd }: { data: Data; onEdit: (worker: Worker) => void; onDelete: (worker: Worker) => void; onAdd: () => void }) {
  const workers = activeWorkers(data);
  return (
    <>
      <h3 className="first">Trabajadores</h3>
      {!workers.length && <div className="empty-card"><p>Todavía no hay trabajadores.</p></div>}
      <div className="workers-list">
        {workers.map((worker) => {
          const count = data.assignments.filter((item) => item.workerId === worker.id).length;
          return (
            <article className="worker" key={worker.id}>
              <i style={{ background: worker.color }} aria-hidden="true">{worker.name[0]?.toUpperCase()}</i>
              <div><strong>{worker.name}</strong><span>{count} {count === 1 ? 'turno registrado' : 'turnos registrados'}</span></div>
              <div className="row-actions">
                <button className="secondary" onClick={() => onEdit(worker)} aria-label={`Editar a ${worker.name}`}><Pencil aria-hidden="true" />Editar</button>
                <button className="danger-outline" onClick={() => onDelete(worker)} aria-label={`Eliminar a ${worker.name}`}><Trash2 aria-hidden="true" />Eliminar</button>
              </div>
            </article>
          );
        })}
      </div>
      <button className="primary full add-shift" onClick={onAdd}><Plus aria-hidden="true" />Agregar trabajador</button>
    </>
  );
}

// ---------------------------------------------------------------------------
// History: one worker at a time — what they worked, totals and what to pay them

type HistoryRange = 'week' | 'month' | 'year' | 'custom';

const shortRange = (start: string, end: string) =>
  start === end ? format(toDate(start), 'dd/MM') : `${format(toDate(start), 'dd/MM')} – ${format(toDate(end), 'dd/MM')}`;

const periodOf = (range: Exclude<HistoryRange, 'custom'>, anchor: Date): [string, string] =>
  range === 'week'
    ? [iso(startOfWeek(anchor, weekOptions)), iso(endOfWeek(anchor, weekOptions))]
    : range === 'month'
      ? [iso(startOfMonth(anchor)), iso(endOfMonth(anchor))]
      : [iso(startOfYear(anchor)), iso(endOfYear(anchor))];

function HistoryView({ data, worker, workers, onWorker, openDay }: {
  data: Data; worker?: Worker; workers: Worker[]; onWorker: (worker: Worker) => void; openDay: (worker: Worker, date: string) => void;
}) {
  const [range, setRange] = useState<HistoryRange>('week');
  const [anchor, setAnchor] = useState(new Date());
  const [from, setFrom] = useState(iso(startOfMonth(new Date())));
  const [to, setTo] = useState(iso(new Date()));
  const now = new Date();
  const [startDate, endDate] = range === 'custom' ? (from <= to ? [from, to] : [to, from]) : periodOf(range, anchor);
  const swipe = useSwipe((direction) => {
    if (!worker || workers.length < 2) return;
    const index = workers.findIndex((entry) => entry.id === worker.id);
    onWorker(workers[(index + direction + workers.length) % workers.length]);
  });

  if (!worker) return <section className="view"><div className="empty-card"><p>Todavía no hay trabajadores.</p></div></section>;

  const step = (delta: number) => setAnchor(range === 'week' ? addWeeks(anchor, delta) : range === 'month' ? addMonths(anchor, delta) : addYears(anchor, delta));
  const isCurrent = range === 'custom' || periodOf(range, now)[0] === startDate;
  const unit = range === 'week' ? 'Semana' : range === 'month' ? 'Mes' : 'Año';
  const title = range === 'week' ? (isCurrent ? 'Esta semana' : `Semana ${getISOWeek(anchor)}`) : range === 'month' ? format(anchor, 'MMMM yyyy', { locale: es }) : format(anchor, 'yyyy');

  const items = data.assignments.filter((item) => item.workerId === worker.id && item.date >= startDate && item.date <= endDate);
  const byDate = new Map(groupByDate(data, items).map((day) => [day.date, day]));
  const summary = paymentService.summarize(items);
  const allWeeks = weeklyTotals(items, startDate, endDate);
  const weeks = allWeeks.length > 6 ? allWeeks.filter((week) => week.shifts) : allWeeks;
  const months: Date[] = [];
  for (let month = startOfMonth(toDate(startDate)); iso(month) <= endDate; month = addMonths(month, 1)) months.push(month);

  return (
    <section className="view">
      <WorkerSwitcher workers={workers} worker={worker} onSelect={onWorker} />
      <div className="segmented history-segment" role="group" aria-label="Periodo">
        {([['week', 'Semana'], ['month', 'Mes'], ['year', 'Año'], ['custom', 'Personalizado']] as const).map(([id, label]) => (
          <button key={id} className={range === id ? 'selected' : ''} aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>
        ))}
      </div>
      {range === 'custom' ? (
        <>
          <div className="range-inputs">
            <label>Desde<input type="date" min="2026-01-01" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>Hasta<input type="date" min="2026-01-01" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
          <p className="period">Periodo: {formatRangeText(startDate, endDate)}</p>
        </>
      ) : (
        <div className="month-nav period-nav">
          <button onClick={() => step(-1)} aria-label={`${unit} anterior`}><ChevronLeft aria-hidden="true" /></button>
          <div className="period-title" aria-live="polite">
            <strong>{title}</strong>
            {range === 'week' && <small>{formatRangeText(startDate, endDate)}</small>}
          </div>
          <button onClick={() => step(1)} aria-label={`${unit} siguiente`}><ChevronRight aria-hidden="true" /></button>
        </div>
      )}
      {!isCurrent && (
        <button className="secondary today-link" onClick={() => setAnchor(new Date())}>
          <Clock3 aria-hidden="true" />{range === 'week' ? 'Volver a esta semana' : range === 'month' ? 'Volver a este mes' : 'Volver a este año'}
        </button>
      )}

      {range === 'week' && <PayCard worker={worker} items={items} />}

      <div className="calendar-card personal-calendar" {...swipe}>
        {range === 'week' && (
          <ul className="week-list">
            {eachDayOfInterval({ start: toDate(startDate), end: toDate(endDate) }).map((date) => {
              const key = iso(date);
              const day = byDate.get(key);
              const what = day ? `${day.items.map((item) => item.shiftNameSnapshot).join(' y ')}, ${paymentService.money(day.total)}` : 'sin turnos';
              return (
                <li key={key}>
                  <button className={day ? 'worked' : ''} onClick={() => openDay(worker, key)} aria-label={`${format(date, "EEEE d 'de' MMMM", { locale: es })}: ${what}`}>
                    <span className="week-day">{format(date, 'EEE d', { locale: es })}</span>
                    <span className="week-shifts">{day ? day.items.map((item) => item.shiftNameSnapshot).join(' + ') : 'Sin turnos'}</span>
                    {day && <b>{paymentService.money(day.total)}</b>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {range === 'year' && (
          <div className="year-grid">
            {months.map((month) => {
              const monthItems = items.filter((item) => item.date.startsWith(format(month, 'yyyy-MM')));
              return (
                <button key={iso(month)} className={monthItems.length ? 'worked' : ''} onClick={() => { setRange('month'); setAnchor(month); }}>
                  <strong>{format(month, 'MMMM', { locale: es })}</strong>
                  <span>{countText(monthItems.length, 'turno', 'turnos')}</span>
                  <b>{paymentService.money(paymentService.total(monthItems))}</b>
                </button>
              );
            })}
          </div>
        )}
        {(range === 'month' || range === 'custom') && months.map((month) => (
          <div className="personal-month" key={iso(month)}>
            {range === 'custom' && <h4>{format(month, 'MMMM yyyy', { locale: es })}</h4>}
            <WorkerDays
              data={data}
              worker={worker}
              days={eachDayOfInterval({ start: startOfWeek(month, weekOptions), end: endOfWeek(endOfMonth(month), weekOptions) })}
              month={month}
              isEnabled={(date) => date >= startDate && date <= endDate}
              onDay={(date) => openDay(worker, date)}
            />
          </div>
        ))}
      </div>
      {range === 'year' && <p className="hint">Toca un mes para ver su calendario.</p>}

      <h3>Resumen</h3>
      <div className="metrics">
        <span>Días trabajados<strong>{summary.days}</strong></span>
        <span>Turnos<strong>{summary.shifts}</strong></span>
        <span>Horas<strong>{formatHours(summary.hours)}</strong></span>
        <span className="metric-total">Total<strong>{paymentService.money(summary.total)}</strong></span>
      </div>

      {range !== 'week' && (
        <>
          <h3>Pago semanal</h3>
          {allWeeks.length > 6 && <p className="hint">Solo se muestran las semanas con turnos.</p>}
          {weeks.length ? (
            <ul className="week-pay">
              {weeks.map((week) => (
                <li key={week.start}>
                  <span>
                    <strong>{range === 'month' ? `Semana ${allWeeks.indexOf(week) + 1}` : `Semana ${getISOWeek(toDate(week.start))}`}</strong>
                    <small>{shortRange(week.start, week.end)} · {countText(week.shifts, 'turno', 'turnos')}</small>
                  </span>
                  <b>{paymentService.money(week.total)}</b>
                </li>
              ))}
            </ul>
          ) : <p className="empty">Sin turnos en este periodo.</p>}
        </>
      )}
    </section>
  );
}

// "¿Cuánto le tengo que pagar esta semana?": the total first and large, then what it is made of.
function PayCard({ worker, items }: { worker: Worker; items: Assignment[] }) {
  const lines = paymentBreakdown(items);
  const total = paymentService.total(items);
  const repeatedName = (name: string) => lines.filter((line) => line.name === name).length > 1;
  return (
    <section className="pay-total" aria-label={`Total a pagar a ${worker.name}`}>
      <p className="pay-label">Total a pagar</p>
      <p className="pay-amount">{paymentService.money(total)}</p>
      {lines.length > 0 ? (
        <ul>
          {lines.map((line) => (
            <li key={`${line.name}|${line.unit}`}>
              <span>{line.name} × {line.count}{repeatedName(line.name) ? ` (${paymentService.money(line.unit)})` : ''}</span>
              <strong>{paymentService.money(line.total)}</strong>
            </li>
          ))}
          <li className="pay-sum"><span>Total</span><strong>{paymentService.money(total)}</strong></li>
        </ul>
      ) : <p className="pay-empty">Sin turnos en esta semana.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Settings, export and preview

function SettingsView({ data, workers, onEditShift, onAddShift, onOpenExport, onImport, onInvalidFile, textSize, onTextSize }: {
  data: Data; workers: ReactNode; onEditShift: (shift: Shift) => void; onAddShift: () => void; onOpenExport: (kind: ExportFormat) => void; onImport: (value: unknown) => void;
  onInvalidFile: () => void; textSize: TextSize; onTextSize: (id: TextSize) => void;
}) {
  const importRef = useRef<HTMLInputElement>(null);
  const used = storageUsage(data);
  const percent = Math.min(100, (used / storageLimitBytes) * 100);

  const read = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        onImport(JSON.parse(String(reader.result)));
      } catch {
        onInvalidFile();
      }
    };
    reader.onerror = onInvalidFile;
    reader.readAsText(file);
  };

  return (
    <section className="view settings">
      {workers}

      <h3>Tamaño del texto</h3>
      <div className="segmented text-size" role="group" aria-label="Tamaño del texto">
        {textSizes.map((size) => (
          <button key={size.id} className={textSize === size.id ? 'selected' : ''} aria-pressed={textSize === size.id} onClick={() => onTextSize(size.id)}>
            <span aria-hidden="true" style={{ fontSize: `${size.scale * 1.25}rem` }}>Aa</span>
            {size.label}
          </button>
        ))}
      </div>
      <p className="hint">Los botones mantienen su tamaño para que sigan siendo fáciles de tocar.</p>

      <h3>Configuración de turnos</h3>
      <p className="hint">El pago es fijo por turno. Los cambios solo afectan a los turnos nuevos.</p>
      <div className="shift-cards">
        {activeShifts(data).map((shift) => (
          <article className="shift-card" key={shift.id}>
            <span className="shift-icon" aria-hidden="true">{shift.icon}</span>
            <div>
              <strong>{shift.name}</strong>
              <span>{formatHours(shift.defaultHours)} · {paymentService.money(shift.paymentAmount)}</span>
            </div>
            <button className="secondary" onClick={() => onEditShift(shift)} aria-label={`Editar turno ${shift.name}`}><Pencil aria-hidden="true" />Editar</button>
          </article>
        ))}
      </div>
      <button className="primary full add-shift" onClick={onAddShift}><Plus aria-hidden="true" />Añadir turno</button>

      <h3>Almacenamiento</h3>
      <div className="storage">
        <span>Espacio utilizado en este dispositivo</span>
        <strong>{(used / 1024).toFixed(1)} KB <small>de 5 MB ({percent.toFixed(percent < 1 ? 1 : 0)} %)</small></strong>
        <div className="meter" role="progressbar" aria-label="Espacio utilizado" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${Math.max(percent, 1)}%` }} /></div>
        {percent > 80 && <FormError message="El almacenamiento está casi lleno. Haz una copia de seguridad." />}
      </div>

      <h3>Exportar e importar</h3>
      <div className="settings-list">
        <button onClick={() => onOpenExport('pdf')}><FileDown aria-hidden="true" /><span>Exportar informe PDF<small>Para imprimir o enviar</small></span><ChevronRight aria-hidden="true" /></button>
        <button onClick={() => onOpenExport('excel')}><FileDown aria-hidden="true" /><span>Exportar Excel<small>Hoja de cálculo por trabajador</small></span><ChevronRight aria-hidden="true" /></button>
        <button onClick={() => onOpenExport('txt')}><FileDown aria-hidden="true" /><span>Exportar texto (TXT)<small>Informe sencillo y legible</small></span><ChevronRight aria-hidden="true" /></button>
        <button onClick={() => onOpenExport('json')}><Download aria-hidden="true" /><span>Hacer copia de seguridad<small>Archivo JSON para restaurar la aplicación</small></span><ChevronRight aria-hidden="true" /></button>
        <button onClick={() => importRef.current?.click()}><Upload aria-hidden="true" /><span>Restaurar copia de seguridad<small>Desde un archivo JSON</small></span><ChevronRight aria-hidden="true" /></button>
        <input ref={importRef} type="file" accept="application/json,.json" onChange={read} hidden />
      </div>

      <h3>Información de la aplicación</h3>
      <div className="info-list">
        <p><span>Aplicación</span><strong>Montrack</strong></p>
        <p><span>Versión de datos</span><strong>2 (turnos)</strong></p>
        <p><span>Trabajadores</span><strong>{activeWorkers(data).length}</strong></p>
        <p><span>Turnos registrados</span><strong>{data.assignments.length}</strong></p>
        <p><span>Datos guardados</span><strong>Solo en este dispositivo</strong></p>
      </div>
      <p className="about"><Info aria-hidden="true" />Montrack funciona sin conexión. Haz una copia de seguridad cada mes.</p>
    </section>
  );
}

const exportWorkers = (data: Data) => data.workers.filter((worker) => !worker.archived || data.assignments.some((item) => item.workerId === worker.id));

const formatOptions: { id: ExportFormat; label: string; detail: string }[] = [
  { id: 'pdf', label: 'PDF', detail: 'Informe para imprimir' },
  { id: 'excel', label: 'Excel', detail: 'Hoja de cálculo (.xlsx)' },
  { id: 'txt', label: 'Texto', detail: 'Archivo TXT sencillo' },
  { id: 'json', label: 'Copia de seguridad', detail: 'JSON para restaurar' },
];

function ExportDialog({ data, request, onClose, onPreview, onRun }: {
  data: Data; request: ExportRequest; onClose: () => void; onPreview: (kind: ExportFormat, config: ExportConfig) => void; onRun: ExportRunner;
}) {
  const workers = exportWorkers(data);
  const allDates = data.assignments.map((item) => item.date).sort();
  const [kind, setKind] = useState<ExportFormat>(request.format);
  const [config, setConfig] = useState<ExportConfig>(() => ({
    startDate: request.startDate ?? allDates[0] ?? iso(startOfMonth(new Date())),
    endDate: request.endDate ?? allDates[allDates.length - 1] ?? iso(endOfMonth(new Date())),
    workerIds: workers.map((worker) => worker.id),
  }));
  const [error, setError] = useState('');
  const lastMonth = subMonths(new Date(), 1);
  const setRange = (startDate: string, endDate: string) => {
    setError('');
    setConfig((current) => ({ ...current, startDate, endDate }));
  };
  const toggleWorker = (workerId: string) => {
    setError('');
    setConfig((current) => ({ ...current, workerIds: current.workerIds.includes(workerId) ? current.workerIds.filter((id) => id !== workerId) : [...current.workerIds, workerId] }));
  };
  const commit = (action: 'preview' | 'download' | 'share') => {
    if (!config.startDate || !config.endDate) return setError('Elige las fechas.');
    if (!config.workerIds.length) return setError('Selecciona al menos un trabajador.');
    if (action === 'preview') onPreview(kind, config);
    else onRun(kind, action, config);
  };
  const [shownStart, shownEnd] = config.startDate <= config.endDate ? [config.startDate, config.endDate] : [config.endDate, config.startDate];

  return (
    <Modal close={onClose} className="export-dialog" eyebrow="EXPORTAR" title="¿Qué quieres exportar?">
      <fieldset className="format-options">
        <legend>Formato</legend>
        {formatOptions.map((option) => (
          <label key={option.id} className={kind === option.id ? 'checked' : ''}>
            <input type="radio" name="export-format" checked={kind === option.id} onChange={() => setKind(option.id)} />
            <span><strong>{option.label}</strong><small>{option.detail}</small></span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Fechas</legend>
        <div className="quick-ranges">
          <button type="button" className="secondary" onClick={() => setRange(iso(startOfMonth(new Date())), iso(endOfMonth(new Date())))}>Este mes</button>
          <button type="button" className="secondary" onClick={() => setRange(iso(startOfMonth(lastMonth)), iso(endOfMonth(lastMonth)))}>Mes pasado</button>
          <button type="button" className="secondary" disabled={!allDates.length} onClick={() => setRange(allDates[0], allDates[allDates.length - 1])}>Todo</button>
        </div>
        <div className="export-grid">
          <label>Desde<input type="date" min="2026-01-01" value={config.startDate} onChange={(event) => setRange(event.target.value, config.endDate)} /></label>
          <label>Hasta<input type="date" min="2026-01-01" value={config.endDate} onChange={(event) => setRange(config.startDate, event.target.value)} /></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Trabajadores</legend>
        <div className="export-worker-actions">
          <button type="button" className="secondary" onClick={() => { setError(''); setConfig((current) => ({ ...current, workerIds: workers.map((worker) => worker.id) })); }}>Seleccionar todos</button>
          <button type="button" className="secondary" onClick={() => setConfig((current) => ({ ...current, workerIds: [] }))}>Quitar todos</button>
        </div>
        <div className="export-worker-list">
          {workers.map((worker) => (
            <label key={worker.id} className="export-worker-item">
              <input type="checkbox" checked={config.workerIds.includes(worker.id)} onChange={() => toggleWorker(worker.id)} />
              <span>{workerLabel(worker)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="export-summary">
        <strong>{config.workerIds.length} {config.workerIds.length === 1 ? 'trabajador' : 'trabajadores'}</strong>
        <span>{shownStart && shownEnd ? formatRangeText(shownStart, shownEnd) : ''}</span>
      </div>
      <FormError message={error} />
      <div className="export-actions">
        <button type="button" className="secondary big" onClick={() => commit('preview')}><Eye aria-hidden="true" />Vista previa</button>
        <button type="button" className="secondary big" onClick={() => commit('share')}><Share2 aria-hidden="true" />Compartir</button>
      </div>
      <button type="button" className="primary full" onClick={() => commit('download')}><Download aria-hidden="true" />Descargar</button>
    </Modal>
  );
}

function PreviewModal({ data, format: kind, config, onClose, onRun }: { data: Data; format: ExportFormat; config: ExportConfig; onClose: () => void; onRun: ExportRunner }) {
  const report = buildReport(data, config);
  const label = formatOptions.find((option) => option.id === kind)?.label ?? kind;
  return (
    <Modal close={onClose} className="preview-modal" eyebrow={`VISTA PREVIA · ${label.toUpperCase()}`} title={`Periodo: ${formatRangeText(report.startDate, report.endDate)}`}>
      {kind === 'txt' && <pre>{buildReportText(report)}</pre>}
      {kind === 'json' && <pre>{JSON.stringify(buildBackup(data, config), null, 2)}</pre>}
      {(kind === 'pdf' || kind === 'excel') && (
        <div className="report-preview">
          {report.sections.map(({ worker, days, summary }) => (
            <section key={worker.id}>
              <h3>{worker.name}</h3>
              <table>
                <thead><tr><th scope="col">Fecha</th><th scope="col">Turno</th><th scope="col">Horas</th><th scope="col">Total</th></tr></thead>
                <tbody>
                  {days.flatMap((day) => day.items).map((item) => (
                    <tr key={item.id}><td>{formatDateText(item.date)}</td><td>{item.shiftNameSnapshot}</td><td>{formatHours(item.hours)}</td><td>{paymentService.money(item.paymentSnapshot)}</td></tr>
                  ))}
                  {!days.length && <tr><td colSpan={4}>Sin turnos en este periodo.</td></tr>}
                </tbody>
              </table>
              <p className="report-total">Días: <b>{summary.days}</b> · Horas: <b>{formatHours(summary.hours)}</b> · Total: <b>{paymentService.money(summary.total)}</b></p>
            </section>
          ))}
        </div>
      )}
      <div className="export-actions">
        <button type="button" className="secondary big" onClick={() => onRun(kind, 'share', config)}><Share2 aria-hidden="true" />Compartir</button>
        <button type="button" className="primary big" onClick={() => onRun(kind, 'download', config)}><Download aria-hidden="true" />Descargar</button>
      </div>
    </Modal>
  );
}

applyTextSize(readTextSize());

// Older iPhones ignore user-scalable=no and touch-action; block their pinch gesture directly.
document.addEventListener('gesturestart', (event) => event.preventDefault());
document.addEventListener('touchmove', (event) => { if (event.touches.length > 1) event.preventDefault(); }, { passive: false });

registerSW({
  immediate: true,
  onOfflineReady() {
    console.info('Montrack is ready for offline use.');
  },
  onNeedRefresh() {
    console.info('Montrack has a new version available.');
  },
});

createRoot(document.getElementById('root')!).render(<App />);
