// Минимальный генератор .xlsx без тяжёлых библиотек.
// .xlsx — это zip-архив с XML-файлами; упаковываем его через fflate.
import { strToU8, zipSync } from 'fflate';

// Индексы стилей (см. STYLES ниже)
export const S = { HEADER: 1, DATE: 2, DATETIME: 3, MONEY: 4, TOTAL: 5, TITLE: 6, PERCENT: 7 };

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const xmlEsc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // убираем управляющие символы, недопустимые в XML
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Дата 'YYYY-MM-DD' (+ часы/минуты) → серийный номер даты Excel */
export function excelSerial(y, m, d, hh = 0, mm = 0) {
  return (Date.UTC(y, m - 1, d, hh, mm) - Date.UTC(1899, 11, 30)) / 86400000;
}

/**
 * Ячейка: число, строка, null или объект { v, s, f }
 *   v — значение, s — индекс стиля, f — формула (v тогда — заранее посчитанный результат)
 */
function cellXml(ref, c) {
  if (c === null || c === undefined) return '';
  if (typeof c !== 'object') c = { v: c };
  const st = c.s ? ` s="${c.s}"` : '';
  if (c.f) return `<c r="${ref}"${st}><f>${xmlEsc(c.f)}</f>${typeof c.v === 'number' ? `<v>${c.v}</v>` : ''}</c>`;
  if (typeof c.v === 'number' && Number.isFinite(c.v)) return `<c r="${ref}"${st}><v>${c.v}</v></c>`;
  if (c.v === '' || c.v === null || c.v === undefined) return st ? `<c r="${ref}"${st}/>` : '';
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
}

function sheetXml({ rows, widths = [], freezeHeader = false, autoFilter = null }) {
  const view = freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const data = rows.map((row, r) => {
    const cells = (row || []).map((c, i) => cellXml(`${colName(i)}${r + 1}`, c)).join('');
    return `<row r="${r + 1}">${cells}</row>`;
  }).join('');
  const filter = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">${view}${cols}<sheetData>${data}</sheetData>${filter}</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">
<numFmts count="4">
<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>
<numFmt numFmtId="165" formatCode="dd.mm.yyyy hh:mm"/>
<numFmt numFmtId="166" formatCode="#,##0.00"/>
<numFmt numFmtId="167" formatCode="0%"/>
</numFmts>
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="14"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3EDFB"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * sheets: [{ name, rows, widths?, freezeHeader?, autoFilter? }]
 * Возвращает Uint8Array с готовым .xlsx
 */
export function buildXlsx(sheets) {
  const n = sheets.length;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '</Types>',
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + `<workbook xmlns="${NS}" xmlns:r="${NS_R}"><sheets>`
      + sheets.map((s, i) => `<sheet name="${xmlEsc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
      + '</Relationships>',
    'xl/styles.xml': STYLES,
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s); });

  const zipInput = {};
  for (const [path, content] of Object.entries(files)) zipInput[path] = strToU8(content);
  return zipSync(zipInput, { level: 6 });
}
