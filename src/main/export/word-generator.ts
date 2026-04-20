import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, AlignmentType, HeadingLevel, BorderStyle,
} from 'docx'
import { parseBijlageAnalysesRow } from './parse-bijlage-analyses'
import { formatDate } from '../../shared/date-format'

export async function generateWord(
  tenders: any[],
  criteria: any[],
  questions: any[],
  options: { includeAnalysis?: boolean, includeScores?: boolean }
): Promise<Buffer> {
  const sections = []

  for (const tender of tenders) {
    const children: any[] = []

    // Title
    children.push(
      new Paragraph({
        text: tender.titel,
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 200 },
      })
    )

    // Info table
    const infoData: [string, string][] = []
    if (tender.opdrachtgever) infoData.push(['Opdrachtgever', tender.opdrachtgever])
    if (tender.regio) infoData.push(['Regio', tender.regio])
    if (tender.type_opdracht) infoData.push(['Type', tender.type_opdracht])
    if (tender.geraamde_waarde) infoData.push(['Geraamde waarde', tender.geraamde_waarde])
    if (tender.publicatiedatum) infoData.push(['Publicatiedatum', formatDate(tender.publicatiedatum)])
    if (tender.sluitingsdatum) infoData.push(['Sluitingsdatum', formatDate(tender.sluitingsdatum)])
    if (tender.referentienummer) infoData.push(['Referentie', tender.referentienummer])
    if (tender.bron_website_naam) infoData.push(['Bron', tender.bron_website_naam])

    if (infoData.length > 0) {
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: infoData.map(([label, value]) =>
            new TableRow({
              children: [
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: label, bold: true })] })],
                  width: { size: 30, type: WidthType.PERCENTAGE },
                  shading: { fill: 'f0f4f8' },
                }),
                new TableCell({
                  children: [new Paragraph({ text: value || '-' })],
                  width: { size: 70, type: WidthType.PERCENTAGE },
                }),
              ],
            })
          ),
        })
      )
      children.push(new Paragraph({ text: '', spacing: { after: 200 } }))
    }

    // Score
    if (options.includeScores && tender.totaal_score != null) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: 'Relevantiescore: ', bold: true }),
            new TextRun({
              text: `${Math.round(tender.totaal_score)}%`,
              bold: true,
              color: tender.totaal_score >= 70 ? '16a34a' : tender.totaal_score >= 40 ? 'ca8a04' : 'dc2626',
              size: 28,
            }),
          ],
          spacing: { after: 100 },
        })
      )
      if (tender.match_uitleg) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: tender.match_uitleg, italics: true, color: '4b5563' })],
            spacing: { after: 200 },
          })
        )
      }
    }

    // Summary
    if (options.includeAnalysis && tender.ai_samenvatting) {
      children.push(
        new Paragraph({ text: 'Samenvatting', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }),
        new Paragraph({ text: tender.ai_samenvatting, spacing: { after: 200 } })
      )
    }

    // AI Answers
    if (options.includeAnalysis && tender.ai_antwoorden) {
      try {
        const antwoorden = JSON.parse(tender.ai_antwoorden)
        if (Object.keys(antwoorden).length > 0) {
          children.push(
            new Paragraph({ text: 'Analyse', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } })
          )
          for (const q of questions) {
            if (antwoorden[q.id]) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: q.vraag, bold: true })],
                  spacing: { after: 50 },
                }),
                new Paragraph({
                  text: antwoorden[q.id],
                  indent: { left: 360 },
                  spacing: { after: 150 },
                })
              )
            }
          }
        }
      } catch {}
    }

    if (options.includeAnalysis) {
      const bijlagen = parseBijlageAnalysesRow(tender)
      if (bijlagen.length > 0) {
        children.push(
          new Paragraph({
            text: 'Analyse per bijlage',
            heading: HeadingLevel.HEADING_2,
            spacing: { after: 80 },
          }),
          new Paragraph({
            children: [
              new TextRun({
                text:
                  'Op basis van alle gelezen documenten van de bron (o.a. TenderNed-tabbladen en Mercell waar van toepassing). Per bestand: samenvatting, punten, risico’s en een score.',
                color: '6b7280',
                size: 18,
              }),
            ],
            spacing: { after: 200 },
          })
        )
        for (const b of bijlagen) {
          const s = typeof b.score === 'number' && !Number.isNaN(b.score) ? b.score : 0
          const scoreHex = s >= 70 ? '16a34a' : s >= 40 ? 'ca8a04' : 'dc2626'
          children.push(
            new Paragraph({
              children: [
                new TextRun({ text: b.naam || 'Bijlage', bold: true }),
                new TextRun({ text: '  —  ', color: '9ca3af' }),
                new TextRun({ text: `${Math.round(s)}/100`, bold: true, color: scoreHex, size: 24 }),
              ],
              spacing: { before: 160, after: 80 },
            })
          )
          if (b.bron) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: `Bron: ${b.bron}`, color: '6b7280', size: 18 })],
                spacing: { after: 80 },
              })
            )
          }
          if (b.samenvatting) {
            children.push(new Paragraph({ text: b.samenvatting, spacing: { after: 120 } }))
          }
          const punten = Array.isArray(b.belangrijkste_punten) ? b.belangrijkste_punten.filter(Boolean) : []
          if (punten.length > 0) {
            children.push(
              new Paragraph({
                children: [new TextRun({ text: 'Belangrijkste punten', bold: true, size: 18 })],
                spacing: { after: 40 },
              })
            )
            for (const p of punten) {
              children.push(
                new Paragraph({
                  children: [new TextRun({ text: `• ${p}` })],
                  indent: { left: 360 },
                  spacing: { after: 40 },
                })
              )
            }
            children.push(new Paragraph({ text: '', spacing: { after: 80 } }))
          }
          const risicos = Array.isArray(b.risicos) ? b.risicos.filter(Boolean) : []
          if (risicos.length > 0) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: 'Risico’s: ', bold: true, color: 'dc2626', size: 18 }),
                  new TextRun({ text: risicos.join('; '), color: 'dc2626', size: 18 }),
                ],
                spacing: { after: 120 },
              })
            )
          }
          if (b.uitleg_score) {
            children.push(
              new Paragraph({
                children: [
                  new TextRun({ text: 'Uitleg score: ', bold: true }),
                  new TextRun({ text: b.uitleg_score, color: '4b5563' }),
                ],
                spacing: { after: 120 },
              })
            )
          }
          children.push(
            new Paragraph({
              border: {
                bottom: { color: 'e5e7eb', space: 1, style: BorderStyle.SINGLE, size: 6 },
              },
              spacing: { after: 80 },
            })
          )
        }
      }
    }

    // Description
    if (tender.beschrijving) {
      children.push(
        new Paragraph({ text: 'Beschrijving', heading: HeadingLevel.HEADING_2, spacing: { after: 100 } }),
        new Paragraph({ text: tender.beschrijving, spacing: { after: 200 } })
      )
    }

    sections.push({ children })
  }

  // Footer section
  if (sections.length > 0) {
    sections[sections.length - 1].children.push(
      new Paragraph({ text: '', spacing: { before: 600 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: 'Created by Questric AI - www.questric.eu', color: '9ca3af', size: 18 }),
        ],
      })
    )
  }

  const doc = new Document({
    creator: 'TenderTracker - Questric AI',
    title: 'Aanbestedingsrapport - Van de Kreeke Groep',
    description: 'Automatisch gegenereerd aanbestedingsrapport',
    sections,
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
