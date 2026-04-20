import { parseBijlageAnalysesRow } from './parse-bijlage-analyses'
import { formatDate, formatDateTime } from '../../shared/date-format'

// Lazy-load pdfmake to avoid startup crash from circular deps
let PdfPrinter: any = null

function getPrinter() {
  if (!PdfPrinter) {
    PdfPrinter = require('pdfmake')
  }
  return PdfPrinter
}

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
}

export async function generatePdf(
  tenders: any[],
  criteria: any[],
  questions: any[],
  options: { includeAnalysis?: boolean, includeScores?: boolean }
): Promise<Buffer> {
  const Printer = getPrinter()
  const printer = new Printer(fonts)

  const content: any[] = [
    {
      text: 'TenderTracker - Aanbestedingsrapport',
      style: 'header',
      margin: [0, 0, 0, 5],
    },
    {
      text: 'Van de Kreeke Groep',
      style: 'subheader',
      margin: [0, 0, 0, 3],
    },
    {
      text: `Gegenereerd op: ${formatDateTime(new Date().toISOString())}`,
      style: 'date',
      margin: [0, 0, 0, 20],
    },
    {
      text: `Totaal ${tenders.length} aanbesteding${tenders.length !== 1 ? 'en' : ''}`,
      margin: [0, 0, 0, 15],
    },
  ]

  for (const tender of tenders) {
    if (tenders.indexOf(tender) > 0) {
      content.push({ text: '', pageBreak: 'before' })
    }
    content.push({
      text: tender.titel,
      style: 'tenderTitle',
      margin: [0, 10, 0, 8],
    })

    const infoRows: any[][] = []
    if (tender.opdrachtgever) infoRows.push(['Opdrachtgever', tender.opdrachtgever])
    if (tender.regio) infoRows.push(['Regio', tender.regio])
    if (tender.type_opdracht) infoRows.push(['Type', tender.type_opdracht])
    if (tender.geraamde_waarde) infoRows.push(['Geraamde waarde', tender.geraamde_waarde])
    if (tender.publicatiedatum) infoRows.push(['Publicatiedatum', formatDate(tender.publicatiedatum)])
    if (tender.sluitingsdatum) infoRows.push(['Sluitingsdatum', formatDate(tender.sluitingsdatum)])
    if (tender.referentienummer) infoRows.push(['Referentie', tender.referentienummer])
    if (tender.bron_website_naam) infoRows.push(['Bron', tender.bron_website_naam])

    if (infoRows.length > 0) {
      content.push({
        table: {
          widths: [150, '*'],
          body: infoRows.map(row => [
            { text: row[0], bold: true, fillColor: '#f0f4f8' },
            { text: row[1] || '-' },
          ]),
        },
        layout: 'lightHorizontalLines',
        margin: [0, 0, 0, 10],
      })
    }

    if (options.includeScores && tender.totaal_score != null) {
      const scoreColor = tender.totaal_score >= 70 ? '#16a34a' : tender.totaal_score >= 40 ? '#ca8a04' : '#dc2626'
      content.push({
        text: [
          { text: 'Relevantiescore: ', bold: true },
          { text: `${Math.round(tender.totaal_score)}%`, color: scoreColor, bold: true, fontSize: 14 },
        ],
        margin: [0, 5, 0, 5],
      })
      if (tender.match_uitleg) {
        content.push({ text: tender.match_uitleg, italics: true, color: '#4b5563', margin: [0, 0, 0, 10] })
      }
    }

    if (options.includeAnalysis && tender.ai_samenvatting) {
      content.push(
        { text: 'Samenvatting', style: 'sectionTitle', margin: [0, 10, 0, 5] },
        { text: tender.ai_samenvatting, margin: [0, 0, 0, 10] }
      )
    }

    if (options.includeAnalysis && tender.ai_antwoorden) {
      try {
        const antwoorden = JSON.parse(tender.ai_antwoorden)
        if (Object.keys(antwoorden).length > 0) {
          content.push({ text: 'Analyse', style: 'sectionTitle', margin: [0, 10, 0, 5] })
          for (const q of questions) {
            if (antwoorden[q.id]) {
              content.push(
                { text: q.vraag, bold: true, margin: [0, 5, 0, 2] },
                { text: antwoorden[q.id], margin: [10, 0, 0, 5], color: '#374151' }
              )
            }
          }
        }
      } catch {}
    }

    if (options.includeAnalysis) {
      const bijlagen = parseBijlageAnalysesRow(tender)
      if (bijlagen.length > 0) {
        content.push(
          { text: 'Analyse per bijlage', style: 'sectionTitle', margin: [0, 10, 0, 4] },
          {
            text: 'Op basis van alle gelezen documenten van de bron (o.a. TenderNed-tabbladen en Mercell waar van toepassing). Per bestand: samenvatting, punten, risico’s en een score.',
            color: '#6b7280',
            fontSize: 9,
            margin: [0, 0, 0, 8],
          }
        )
        for (const b of bijlagen) {
          const s = typeof b.score === 'number' && !Number.isNaN(b.score) ? b.score : 0
          const scoreColor = s >= 70 ? '#16a34a' : s >= 40 ? '#ca8a04' : '#dc2626'
          content.push({
            text: [
              { text: b.naam || 'Bijlage', bold: true },
              { text: '  —  ', color: '#9ca3af' },
              { text: `${Math.round(s)}/100`, bold: true, color: scoreColor, fontSize: 11 },
            ],
            margin: [0, 8, 0, 3],
          })
          if (b.bron) {
            content.push({
              text: `Bron: ${b.bron}`,
              fontSize: 9,
              color: '#6b7280',
              margin: [0, 0, 0, 4],
            })
          }
          if (b.samenvatting) {
            content.push({ text: b.samenvatting, margin: [0, 0, 0, 6] })
          }
          const punten = Array.isArray(b.belangrijkste_punten) ? b.belangrijkste_punten.filter(Boolean) : []
          if (punten.length > 0) {
            content.push({
              text: 'Belangrijkste punten',
              bold: true,
              fontSize: 9,
              margin: [0, 0, 0, 2],
            })
            content.push({ ul: punten, margin: [10, 0, 0, 6] })
          }
          const risicos = Array.isArray(b.risicos) ? b.risicos.filter(Boolean) : []
          if (risicos.length > 0) {
            content.push({
              text: [
                { text: 'Risico’s: ', bold: true, color: '#dc2626' },
                { text: risicos.join('; '), color: '#dc2626' },
              ],
              fontSize: 9,
              margin: [0, 0, 0, 6],
            })
          }
          if (b.uitleg_score) {
            content.push({
              text: [{ text: 'Uitleg score: ', bold: true }, { text: b.uitleg_score, color: '#4b5563' }],
              margin: [0, 4, 0, 4],
            })
          }
          content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }], margin: [0, 6, 0, 0] })
        }
      }
    }

    if (tender.beschrijving) {
      content.push(
        { text: 'Beschrijving', style: 'sectionTitle', margin: [0, 10, 0, 5] },
        { text: tender.beschrijving, margin: [0, 0, 0, 10] }
      )
    }
  }

  content.push(
    { text: '', margin: [0, 30, 0, 0] },
    { text: 'Created by Questric AI - www.questric.eu', alignment: 'center', color: '#9ca3af', fontSize: 9 }
  )

  const docDefinition = {
    content,
    defaultStyle: { font: 'Helvetica', fontSize: 10 },
    styles: {
      header: { fontSize: 22, bold: true, color: '#1e3a5f' },
      subheader: { fontSize: 14, color: '#1e3a5f' },
      date: { fontSize: 10, color: '#6b7280' },
      tenderTitle: { fontSize: 16, bold: true, color: '#1e3a5f' },
      sectionTitle: { fontSize: 13, bold: true, color: '#374151' },
    },
    pageMargins: [40, 60, 40, 60] as [number, number, number, number],
    footer: (currentPage: number, pageCount: number) => ({
      text: `Pagina ${currentPage} van ${pageCount}`,
      alignment: 'center',
      margin: [0, 20, 0, 0],
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
