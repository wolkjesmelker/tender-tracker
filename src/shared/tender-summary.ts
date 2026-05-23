import type { TenderSummaryExportPayload } from './types'

export interface TenderSummarySectionItem {
  label: string
  value: string
}

export interface TenderSummarySection {
  id: string
  title: string
  subtitle?: string
  items: TenderSummarySectionItem[]
}

const SECTION_LAYOUT: Array<{ id: string; title: string; subtitle?: string; labels: string[] }> = [
  {
    id: 'inhoud',
    title: 'Inhoud van de opdracht',
    subtitle: 'Samenvatting, omschrijving en werkzaamheden',
    labels: ['Wat houdt het in?'],
  },
  {
    id: 'locatie-partijen',
    title: 'Locatie & opdrachtgever',
    subtitle: 'Waar, voor wie en welk type opdracht',
    labels: ['Locatie / regio', 'Opdrachtgever (voor wie)', 'Type opdracht'],
  },
  {
    id: 'planning',
    title: 'Planning & deadlines',
    subtitle: 'Uitvoering en termijnen',
    labels: ['Start uitvoering', 'Einde uitvoering', 'Uiterlijk inschrijven / indienen', 'Publicatie'],
  },
  {
    id: 'financieel',
    title: 'Financieel',
    subtitle: 'Begroting en waarde',
    labels: ['Budget / geraamde waarde'],
  },
  {
    id: 'procedure',
    title: 'Procedure & documenten',
    subtitle: 'Referenties, bron en indiening',
    labels: ['Referentie', 'Procedure', 'Bron', 'Indiening'],
  },
]

/** Gegroepeerde secties voor de samenvatting-modal (zelfde labels als export). */
export function tenderSummarySections(data: TenderSummaryExportPayload): TenderSummarySection[] {
  const rowMap = new Map(tenderSummaryLabelValueRows(data))
  const out: TenderSummarySection[] = []
  for (const def of SECTION_LAYOUT) {
    const items: TenderSummarySectionItem[] = []
    for (const label of def.labels) {
      const value = rowMap.get(label)
      if (value?.trim()) items.push({ label, value: value.trim() })
    }
    if (items.length > 0) {
      out.push({
        id: def.id,
        title: def.title,
        subtitle: def.subtitle,
        items,
      })
    }
  }
  return out
}

/** Label + waarde voor popup, print en Word/PDF (zelfde volgorde). */
export function tenderSummaryLabelValueRows(data: TenderSummaryExportPayload): [string, string][] {
  const rows: [string, string][] = []
  const push = (label: string, v?: string) => {
    const t = v?.trim()
    if (t) rows.push([label, t])
  }
  push('Wat houdt het in?', data.inhoud)
  push('Locatie / regio', data.locatie)
  push('Opdrachtgever (voor wie)', data.opdrachtgever)
  push('Type opdracht', data.typeOpdracht)
  push('Start uitvoering', data.startUitvoering)
  push('Einde uitvoering', data.eindeUitvoering)
  push('Uiterlijk inschrijven / indienen', data.uiterlijkIndienen)
  push('Budget / geraamde waarde', data.budget)
  push('Referentie', data.referentie)
  push('Procedure', data.procedure)
  push('Publicatie', data.publicatie)
  push('Bron', data.bron)
  push('Indiening', data.indiening)
  return rows
}
