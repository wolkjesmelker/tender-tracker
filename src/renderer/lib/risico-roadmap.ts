import type { RisicoAnalyseV2Result } from '../../shared/types-risico-v2'

export type RoadmapStep = {
  id: string
  titel: string
  beschrijving: string
  items: string[]
  prioriteit: 'kritiek' | 'hoog' | 'normaal'
  datum?: string
}

/**
 * Leidt deterministisch aanbevelingsstappen af uit de bestaande JSON-output.
 * Pure functie — geen side-effects of React-afhankelijkheden.
 */
export function buildRoadmapSteps(result: RisicoAnalyseV2Result): RoadmapStep[] {
  const steps: RoadmapStep[] = []

  // Stap 1: Juridische/strategische gates
  const gates: string[] = [
    ...(result.inschrijfstrategie?.belangrijkste_voorwaarden_voor_inschrijving ?? []),
    ...(result.no_go_factoren?.map(f => f.factor) ?? []),
  ]
  if (gates.length > 0 || result.inschrijfstrategie) {
    steps.push({
      id: 'rm-gates',
      titel: 'Juridische & strategische gates',
      beschrijving: 'Controleer harde eisen, knock-outs en no-go signalen vóór verdere investering.',
      items: gates.slice(0, 5),
      prioriteit: (result.no_go_factoren?.length ?? 0) > 0 ? 'kritiek' : 'hoog',
    })
  }

  // Stap 2: Informatie-inwinning via NVI
  const termijnen = result.algemene_tenderanalyse?.belangrijkste_termijnen ?? []
  const nviItems: string[] = [
    ...(result.vragen_nvi?.slice(0, 3).map(v => v.formulering) ?? []),
    ...(result.leemtes?.filter(l => l.vraag_nvi).slice(0, 2).map(l => l.vraag_nvi) ?? []),
  ]
  const nviDatum = Array.isArray(termijnen)
    ? (termijnen.find(t => typeof t === 'string' && (t.toLowerCase().includes('nvi') || t.toLowerCase().includes('inlichtingen'))) as string | undefined)
    : undefined
  if (nviItems.length > 0) {
    steps.push({
      id: 'rm-nvi',
      titel: 'Nota van Inlichtingen',
      beschrijving: `${(result.vragen_nvi?.length ?? 0) + (result.leemtes?.filter(l => l.vraag_nvi).length ?? 0)} punten op te helderen vóór inschrijving.`,
      items: nviItems,
      prioriteit: 'hoog',
      datum: nviDatum,
    })
  }

  // Stap 3: Prijs- en planningsbuffers
  const prijsItems: string[] = result.top5_prijsverhogende_risicofactoren?.slice(0, 3).map(f => f.factor) ?? []
  const planItems: string[] = result.top5_planningsrisicos?.slice(0, 3).map(r => r.risico) ?? []
  const vpItems = [...prijsItems, ...planItems]
  const inPrijsPlanning = result.inschrijfstrategie?.risicos_die_in_prijs_of_planning_moeten_worden_verwerkt ?? []
  if (vpItems.length > 0 || inPrijsPlanning.length > 0) {
    steps.push({
      id: 'rm-prijs',
      titel: 'Prijs- & planningsbuffers',
      beschrijving: "Verwerk bekende risico's in aanneemsom en planning voordat de inschrijving definitief wordt.",
      items: [...vpItems, ...inPrijsPlanning].slice(0, 5),
      prioriteit: 'normaal',
    })
  }

  // Stap 4: Externe verificatie
  const verificatieItems: string[] = [
    ...(result.locatie_en_omgevingsanalyse?.externe_verificatiepunten ?? []),
    ...(result.risicogebieden?.flatMap(g => g.risicos).filter(r => r.verificatie).slice(0, 3).map(r => r.verificatie) ?? []),
  ]
  if (verificatieItems.length > 0) {
    steps.push({
      id: 'rm-verificatie',
      titel: 'Externe verificatie',
      beschrijving: 'Bezoek locatie, raadpleeg externe bronnen en verifieer niet uit stukken aantoonbare feiten.',
      items: verificatieItems.slice(0, 4),
      prioriteit: 'normaal',
    })
  }

  // Stap 5: Inschrijfbeslissing
  const inschrijfDatum = Array.isArray(termijnen)
    ? (termijnen.find(t => typeof t === 'string' && (t.toLowerCase().includes('inschrijving') || t.toLowerCase().includes('sluitingsdatum'))) as string | undefined)
    : undefined
  steps.push({
    id: 'rm-beslissing',
    titel: 'Definitieve inschrijfbeslissing',
    beschrijving: `Advies: ${result.inschrijfadvies ?? '—'} | Overall score: ${result.overall_score ?? '—'}`,
    items: result.inschrijfstrategie?.strategische_aandachtspunten?.slice(0, 3) ?? [],
    prioriteit: result.inschrijfadvies === 'no_go' ? 'kritiek' : result.inschrijfadvies === 'hoog_risico' ? 'hoog' : 'normaal',
    datum: inschrijfDatum,
  })

  return steps
}
