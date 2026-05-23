import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  HeadingLevel,
} from 'docx'
import type { TenderSummaryExportPayload } from '../../shared/types'
import { formatDateTime } from '../../shared/date-format'
import { tenderSummaryLabelValueRows } from '../../shared/tender-summary'

export async function generateTenderSummaryWord(data: TenderSummaryExportPayload): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      text: 'Samenvatting aanbesteding',
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [new TextRun({ text: data.titel, bold: true, size: 28 })],
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Gegenereerd: ${formatDateTime(new Date().toISOString())}`,
          italics: true,
          color: '666666',
          size: 20,
        }),
      ],
      spacing: { after: 240 },
    }),
  ]

  const rows = tenderSummaryLabelValueRows(data)
  if (rows.length > 0) {
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: rows.map(
          ([label, value]) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
                  width: { size: 32, type: WidthType.PERCENTAGE },
                  shading: { fill: 'f0f4f8' },
                }),
                new TableCell({
                  children: value.split('\n').map((line) => new Paragraph({ text: line.trim() || '\u00a0' })),
                  width: { size: 68, type: WidthType.PERCENTAGE },
                }),
              ],
            }),
        ),
      }),
    )
  } else {
    children.push(new Paragraph({ text: 'Geen aanvullende velden ingevuld.', spacing: { after: 200 } }))
  }

  const doc = new Document({ sections: [{ children }] })
  return Buffer.from(await Packer.toBuffer(doc))
}

export async function generateTenderSummaryPdf(data: TenderSummaryExportPayload): Promise<Buffer> {
  let PdfPrinter: any = null
  function getPrinter() {
    if (!PdfPrinter) PdfPrinter = require('pdfmake')
    return PdfPrinter
  }
  const Printer = getPrinter()
  const printer = new Printer({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  })

  const rows = tenderSummaryLabelValueRows(data)
  const body: any[][] = rows.map(([label, val]) => [
    { text: label, bold: true, fillColor: '#f0f4f8', margin: [4, 4, 4, 4] },
    { text: val || '-', margin: [4, 4, 4, 4] },
  ])

  const content: any[] = [
    { text: 'Samenvatting aanbesteding', style: 'header', margin: [0, 0, 0, 6] },
    { text: 'Van de Kreeke Groep — TenderTracker', style: 'sub', margin: [0, 0, 0, 12] },
    { text: data.titel, style: 'title', margin: [0, 0, 0, 8] },
    {
      text: `Gegenereerd: ${formatDateTime(new Date().toISOString())}`,
      fontSize: 9,
      color: '#6b7280',
      margin: [0, 0, 0, 16],
    },
  ]

  if (body.length > 0) {
    content.push({
      table: { widths: [150, '*'], body },
      layout: 'lightHorizontalLines',
      margin: [0, 0, 0, 12],
    })
  } else {
    content.push({ text: 'Geen aanvullende velden ingevuld.', margin: [0, 0, 0, 12] })
  }

  const docDefinition = {
    content,
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: {
      header: { fontSize: 18, bold: true, color: '#1e3a5f' },
      sub: { fontSize: 10, color: '#6b7280' },
      title: { fontSize: 14, bold: true, color: '#111827' },
    },
    pageMargins: [40, 50, 40, 50] as [number, number, number, number],
    footer: (currentPage: number, pageCount: number) => ({
      text: `Pagina ${currentPage} van ${pageCount}`,
      alignment: 'center' as const,
      margin: [0, 16, 0, 0],
      fontSize: 8,
      color: '#9ca3af',
    }),
  }

  return new Promise((resolve, reject) => {
    const doc = printer.createPdfKitDocument(docDefinition)
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.end()
  })
}
