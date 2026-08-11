/**
 * Recognition export (FR-25) — CSV (hand-rolled, proper quoting) or XLSX
 * (exceljs). Used by GET /api/admin/export; the route sets the
 * Content-Disposition attachment headers from the returned filename.
 *
 * Unlike the feed, exports may include ALL statuses (committee needs the
 * removed rows for governance reviews) unless a status filter is given.
 */
import ExcelJS from 'exceljs'
import { getDb } from '../db/knex'
import { formatIst, istDayEndIso, istDayStartIso, nowIso } from '../db/time'
import { RecognitionStatus } from '../types'

export interface ExportFilters {
  /** IST calendar dates, YYYY-MM-DD (inclusive). */
  from?: string
  to?: string
  function?: string
  site?: string
  behaviourId?: number
  status?: RecognitionStatus
}

export type ExportFormat = 'csv' | 'xlsx'

interface ExportRow {
  id: number
  created_at: string
  giver_code: string
  giver_name: string
  giver_function: string
  giver_site: string
  giver_shift: string
  recipient_code: string
  recipient_name: string
  recipient_function: string
  recipient_site: string
  recipient_shift: string
  behaviour_name: string
  reason_text: string
  channel: string
  status: string
  removal_reason: string | null
  removed_by: string | null
}

/** Column contract from SPEC §5 — order and headers are load-bearing. */
const COLUMNS: { header: string; width: number; value: (r: ExportRow) => string | number }[] = [
  { header: 'ID', width: 8, value: (r) => r.id },
  { header: 'Date', width: 20, value: (r) => formatIst(r.created_at, 'DD MMM YYYY HH:mm') },
  { header: 'Giver Code', width: 12, value: (r) => r.giver_code },
  { header: 'Giver Name', width: 24, value: (r) => r.giver_name },
  { header: 'Giver Function', width: 16, value: (r) => r.giver_function },
  { header: 'Giver Site', width: 16, value: (r) => r.giver_site },
  { header: 'Giver Shift', width: 11, value: (r) => r.giver_shift },
  { header: 'Recipient Code', width: 14, value: (r) => r.recipient_code },
  { header: 'Recipient Name', width: 24, value: (r) => r.recipient_name },
  { header: 'Recipient Function', width: 18, value: (r) => r.recipient_function },
  { header: 'Recipient Site', width: 16, value: (r) => r.recipient_site },
  { header: 'Recipient Shift', width: 14, value: (r) => r.recipient_shift },
  { header: 'Behaviour', width: 20, value: (r) => r.behaviour_name },
  { header: 'Reason', width: 70, value: (r) => r.reason_text },
  { header: 'Channel', width: 11, value: (r) => r.channel },
  { header: 'Status', width: 10, value: (r) => r.status },
  { header: 'Removal Reason', width: 40, value: (r) => r.removal_reason ?? '' },
  { header: 'Removed By', width: 28, value: (r) => r.removed_by ?? '' },
]

async function loadRows(filters: ExportFilters): Promise<ExportRow[]> {
  const query = getDb()('recognitions as rec')
    .join('employees as g', 'g.id', 'rec.giver_id')
    .join('employees as r', 'r.id', 'rec.recipient_id')
    .join('behaviours as b', 'b.id', 'rec.behaviour_id')
  if (filters.status) query.where('rec.status', filters.status)
  if (filters.from) query.andWhere('rec.created_at', '>=', istDayStartIso(filters.from))
  if (filters.to) query.andWhere('rec.created_at', '<=', istDayEndIso(filters.to))
  if (filters.behaviourId) query.andWhere('rec.behaviour_id', filters.behaviourId)
  // Same matching rule as the feed: either side of the recognition.
  if (filters.function) {
    query.andWhere((w) => w.where('g.function', filters.function!).orWhere('r.function', filters.function!))
  }
  if (filters.site) {
    query.andWhere((w) => w.where('g.site', filters.site!).orWhere('r.site', filters.site!))
  }
  return (await query
    .select(
      'rec.id as id',
      'rec.created_at as created_at',
      'g.employee_code as giver_code',
      'g.name as giver_name',
      'g.function as giver_function',
      'g.site as giver_site',
      'g.shift as giver_shift',
      'r.employee_code as recipient_code',
      'r.name as recipient_name',
      'r.function as recipient_function',
      'r.site as recipient_site',
      'r.shift as recipient_shift',
      'b.name as behaviour_name',
      'rec.reason_text as reason_text',
      'rec.channel as channel',
      'rec.status as status',
      'rec.removal_reason as removal_reason',
      'rec.removed_by as removed_by',
    )
    .orderBy('rec.created_at', 'asc')
    .orderBy('rec.id', 'asc')) as ExportRow[]
}

/** RFC 4180 quoting: wrap when the value contains a comma, quote or newline. */
function csvField(value: string | number): string {
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(rows: ExportRow[]): Buffer {
  const lines: string[] = [COLUMNS.map((c) => csvField(c.header)).join(',')]
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => csvField(c.value(row))).join(','))
  }
  // UTF-8 BOM + CRLF so Excel opens Hindi/Bengali reasons correctly.
  return Buffer.from('\ufeff' + lines.join('\r\n') + '\r\n', 'utf8')
}

async function buildXlsx(rows: ExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Gainwell CHAMP Spot Recognition Tool'
  workbook.created = new Date()
  const sheet = workbook.addWorksheet('Recognitions', {
    views: [{ state: 'frozen', ySplit: 1 }], // keep the header visible
  })
  sheet.columns = COLUMNS.map((c) => ({ header: c.header, width: c.width }))
  for (const row of rows) {
    sheet.addRow(COLUMNS.map((c) => c.value(row)))
  }
  sheet.getRow(1).font = { bold: true }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function exportRecognitions(
  filters: ExportFilters,
  format: ExportFormat,
): Promise<{ filename: string; contentType: string; body: Buffer }> {
  const rows = await loadRows(filters)
  const stamp = formatIst(nowIso(), 'YYYYMMDD-HHmm') // IST timestamp in the name
  if (format === 'xlsx') {
    return {
      filename: `champ-recognitions-${stamp}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: await buildXlsx(rows),
    }
  }
  return {
    filename: `champ-recognitions-${stamp}.csv`,
    contentType: 'text/csv; charset=utf-8',
    body: buildCsv(rows),
  }
}
