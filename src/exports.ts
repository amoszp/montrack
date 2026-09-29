import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import type { Assignment, Data, Worker } from './model';
import { formatHours, groupByDate, paymentService, type Summary } from './payment';
import { buildXlsx, type SheetCell } from './xlsx';

export type ExportFormat = 'pdf' | 'excel' | 'txt' | 'json';
export type ExportConfig = { startDate: string; endDate: string; workerIds: string[] };
export type ReportDay = { date: string; items: Assignment[]; hours: number; total: number };
export type ReportSection = { worker: Worker; days: ReportDay[]; summary: Summary };
export type Report = { startDate: string; endDate: string; sections: ReportSection[]; summary: Summary };

export const formatDateText = (value: string | Date) => format(value instanceof Date ? value : new Date(`${value}T12:00:00`), 'dd/MM/yyyy');
export const formatRangeText = (start: string, end: string) => `${formatDateText(start)} - ${formatDateText(end)}`;

export const normalizeRange = (config: ExportConfig): ExportConfig =>
  config.startDate <= config.endDate ? config : { ...config, startDate: config.endDate, endDate: config.startDate };

/** Only the selected workers and the records inside the selected dates; shift configuration is always kept. */
export const filterData = (data: Data, rawConfig: ExportConfig): Data => {
  const config = normalizeRange(rawConfig);
  const selected = new Set(config.workerIds);
  return {
    ...data,
    workers: data.workers.filter((worker) => selected.has(worker.id)),
    assignments: data.assignments.filter((item) => selected.has(item.workerId) && item.date >= config.startDate && item.date <= config.endDate),
  };
};

export const buildReport = (data: Data, rawConfig: ExportConfig): Report => {
  const config = normalizeRange(rawConfig);
  const filtered = filterData(data, config);
  const sections = filtered.workers.map((worker) => {
    const items = filtered.assignments.filter((item) => item.workerId === worker.id);
    return { worker, days: groupByDate(filtered, items), summary: paymentService.summarize(items) };
  });
  return { startDate: config.startDate, endDate: config.endDate, sections, summary: paymentService.summarize(filtered.assignments) };
};

export const buildReportText = (report: Report) => {
  const lines = ['MONTRACK', `Periodo: ${formatRangeText(report.startDate, report.endDate)}`];
  if (!report.sections.length) return [...lines, '', 'No hay trabajadores seleccionados.'].join('\n');
  report.sections.forEach(({ worker, days, summary }) => {
    lines.push('', '========================================', worker.name.toUpperCase(), '========================================');
    if (!days.length) lines.push('', 'Sin turnos en este periodo.');
    days.forEach((day) => {
      lines.push('', formatDateText(day.date));
      day.items.forEach((item) => lines.push(`${item.shiftNameSnapshot} — ${formatHours(item.hours)} — ${paymentService.money(item.paymentSnapshot)}`));
    });
    lines.push('', 'TOTAL', `Días: ${summary.days}`, `Horas: ${formatHours(summary.hours)}`, `Total: ${paymentService.money(summary.total)}`);
  });
  return lines.join('\n');
};

export const buildFileName = (kind: ExportFormat, config: ExportConfig) => {
  const { startDate, endDate } = normalizeRange(config);
  const period = `${startDate.replace(/-/g, '')}_${endDate.replace(/-/g, '')}`;
  const extension = { pdf: 'pdf', excel: 'xlsx', txt: 'txt', json: 'json' }[kind];
  return `montrack-${kind === 'json' ? 'copia' : 'informe'}-${period}.${extension}`;
};

export const createPdfBlob = (report: Report) => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 16;
  const pageWidth = 210;
  const pageHeight = 297;
  const bottom = pageHeight - 20;
  const columns = { date: margin + 3, shift: margin + 38, hours: margin + 112, total: pageWidth - margin - 3 };
  let y = 20;

  const tableHeader = () => {
    pdf.setFillColor('#E8EEF7');
    pdf.rect(margin, y - 5, pageWidth - margin * 2, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor('#1F2A44');
    pdf.text('Fecha', columns.date, y);
    pdf.text('Turno', columns.shift, y);
    pdf.text('Horas', columns.hours, y);
    pdf.text('Total', columns.total, y, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    y += 8;
  };
  const ensure = (height: number, repeatHeader = false) => {
    if (y + height <= bottom) return;
    pdf.addPage();
    y = 20;
    if (repeatHeader) tableHeader();
  };

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.setTextColor('#172238');
  pdf.text('Montrack', margin, y);
  y += 8;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(12);
  pdf.setTextColor('#3F4A5E');
  pdf.text(`Informe de turnos · Periodo: ${formatRangeText(report.startDate, report.endDate)}`, margin, y);
  y += 14;

  if (!report.sections.length) pdf.text('No hay trabajadores seleccionados.', margin, y);

  report.sections.forEach(({ worker, days, summary }) => {
    ensure(40);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(15);
    pdf.setTextColor('#172238');
    pdf.text(worker.name, margin, y + 1);
    y += 10;
    tableHeader();
    pdf.setFontSize(10);
    if (!days.length) {
      pdf.setTextColor('#3F4A5E');
      pdf.text('Sin turnos en este periodo.', columns.date, y);
      y += 8;
    }
    days.forEach((day) => {
      day.items.forEach((item) => {
        ensure(8, true);
        pdf.setTextColor('#172238');
        pdf.text(formatDateText(item.date), columns.date, y);
        pdf.text(item.shiftNameSnapshot, columns.shift, y);
        pdf.text(formatHours(item.hours), columns.hours, y);
        pdf.text(paymentService.money(item.paymentSnapshot), columns.total, y, { align: 'right' });
        pdf.setDrawColor('#E2E8F0');
        pdf.line(margin, y + 2.5, pageWidth - margin, y + 2.5);
        y += 7.5;
      });
    });
    ensure(24);
    y += 3;
    pdf.setFillColor('#F1F5F9');
    pdf.rect(margin, y - 5, pageWidth - margin * 2, 18, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor('#172238');
    pdf.text(`Total de ${worker.name}`, columns.date, y + 1);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Días: ${summary.days}     Horas: ${formatHours(summary.hours)}     Total: ${paymentService.money(summary.total)}`, columns.date, y + 8);
    y += 26;
  });

  const pages = pdf.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    pdf.setPage(page);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor('#5B6679');
    pdf.text(`Montrack · ${formatRangeText(report.startDate, report.endDate)}`, margin, pageHeight - 10);
    pdf.text(`Página ${page} de ${pages}`, pageWidth - margin, pageHeight - 10, { align: 'right' });
  }
  return pdf.output('blob');
};

// Excel serial day number (days since 1899-12-30) so dates sort and filter as real dates.
const excelDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86400000 + 25569;
};

export const createExcelBlob = (report: Report) => {
  const detail: SheetCell[][] = [['Trabajador', 'Fecha', 'Turno', 'Horas', 'Pago (€)'].map((value) => ({ value, style: 'header' }))];
  report.sections.forEach(({ worker, days }) =>
    days.forEach((day) =>
      day.items.forEach((item) =>
        detail.push([
          { value: worker.name },
          { value: excelDate(item.date), style: 'date' },
          { value: item.shiftNameSnapshot },
          { value: item.hours },
          { value: item.paymentSnapshot, style: 'money' },
        ]),
      ),
    ),
  );

  const totals: SheetCell[][] = [
    [{ value: 'Montrack · Totales por trabajador', style: 'header' }],
    [{ value: `Periodo: ${formatRangeText(report.startDate, report.endDate)}` }],
    [],
    ['Trabajador', 'Días', 'Turnos', 'Horas', 'Total (€)', 'Promedio horas/día'].map((value) => ({ value, style: 'header' as const })),
    ...report.sections.map(({ worker, summary }) => [
      { value: worker.name },
      { value: summary.days },
      { value: summary.shifts },
      { value: summary.hours },
      { value: summary.total, style: 'money' as const },
      { value: Math.round(summary.averageHours * 100) / 100 },
    ]),
    [
      { value: 'TOTAL', style: 'header' },
      { value: '' },
      { value: report.summary.shifts, style: 'header' },
      { value: report.summary.hours, style: 'header' },
      { value: report.summary.total, style: 'moneyBold' },
    ],
  ];

  const bytes = buildXlsx([
    { name: 'Turnos', rows: detail, widths: [26, 13, 18, 10, 12], filter: true },
    { name: 'Totales', rows: totals, widths: [30, 10, 10, 10, 14, 20] },
  ]);
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

export const createTextBlob = (report: Report) => new Blob([buildReportText(report)], { type: 'text/plain;charset=utf-8' });

export const buildBackup = (data: Data, config: ExportConfig) => {
  const range = normalizeRange(config);
  return {
    app: 'Montrack',
    format: 'montrack-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    period: { startDate: range.startDate, endDate: range.endDate },
    workerIds: range.workerIds,
    data: filterData(data, range),
  };
};

export const createJsonBlob = (data: Data, config: ExportConfig) => new Blob([JSON.stringify(buildBackup(data, config), null, 2)], { type: 'application/json' });

export const createExportBlob = (kind: ExportFormat, data: Data, config: ExportConfig) => {
  if (kind === 'json') return createJsonBlob(data, config);
  const report = buildReport(data, config);
  if (kind === 'pdf') return createPdfBlob(report);
  if (kind === 'excel') return createExcelBlob(report);
  return createTextBlob(report);
};

export const downloadBlob = (blob: Blob, fileName: string) => {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Opens the system share sheet (WhatsApp, email, Telegram, Drive…) or downloads the file when that is not possible. */
export const shareBlob = async (blob: Blob, fileName: string): Promise<'shared' | 'cancelled' | 'downloaded'> => {
  const file = new File([blob], fileName, { type: blob.type });
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  if (canShare) {
    try {
      await navigator.share({ title: 'Montrack', text: 'Informe de Montrack', files: [file] });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, fileName);
  return 'downloaded';
};
