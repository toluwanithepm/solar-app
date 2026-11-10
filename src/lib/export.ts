// Spreadsheet export: SpreadsheetML (.xls) opens directly in Excel and keeps several sheets.

type Cell = string | number | null | undefined;
export type Sheet = { name: string; rows: Cell[][] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function downloadExcel(filename: string, sheets: Sheet[]) {
  const body = sheets
    .map(
      (sh) =>
        `<Worksheet ss:Name="${esc(sh.name.slice(0, 31))}"><Table>${sh.rows
          .map(
            (r, ri) =>
              `<Row>${r
                .map((c) =>
                  typeof c === 'number'
                    ? `<Cell><Data ss:Type="Number">${c}</Data></Cell>`
                    : `<Cell${ri === 0 ? ' ss:StyleID="h"' : ''}><Data ss:Type="String">${esc(String(c ?? ''))}</Data></Cell>`,
                )
                .join('')}</Row>`,
          )
          .join('')}</Table></Worksheet>`,
    )
    .join('');
  const xml = `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>${body}</Workbook>`;
  download(filename.endsWith('.xls') ? filename : `${filename}.xls`, xml, 'application/vnd.ms-excel');
}

export function downloadCsv(filename: string, rows: Cell[][]) {
  const csv = rows.map((r) => r.map((c) => (c == null ? '' : /[",\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : String(c))).join(',')).join('\r\n');
  download(filename, '﻿' + csv, 'text/csv;charset=utf-8');
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Minimal CSV parser (quoted fields, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
