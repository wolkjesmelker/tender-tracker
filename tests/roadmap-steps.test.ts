import { describe, it, expect } from 'vitest'
import { buildRoadmapSteps } from '../src/renderer/lib/risico-roadmap'
import type { RisicoAnalyseV2Result } from '../src/shared/types-risico-v2'

function makeMinimalResult(overrides: Partial<RisicoAnalyseV2Result> = {}): RisicoAnalyseV2Result {
  return {
    schema_versie: 'v2',
    overall_score: 'Middel',
    overall_toelichting: 'Test',
    inschrijfadvies: 'inschrijfbaar_onder_voorwaarden',
    management_samenvatting: 'Samenvatting',
    bewijs_en_aannameregel: { toegepast: true, toelichting: '', niet_onderbouwde_aannames_geweigerd: true },
    algemene_tenderanalyse: {
      aanbestedende_dienst: 'Gemeente Test',
      procedure: 'Europese aanbesteding',
      opdrachtomschrijving: 'Rioolrenovatie',
      contractvorm: 'RAW',
      gunningssystematiek: 'EMVI',
      belangrijkste_termijnen: [],
      belangrijkste_tenderrisicos: [],
    },
    document_leesplicht_bevestiging: { alle_aangeleverde_documenten_geanalyseerd: true, toelichting: '', ontbrekende_of_onleesbare_documenten: [] },
    document_inventarisatie: [],
    locatie_en_omgevingsanalyse: {
      adres_of_werkgebied: 'Teststraat 1',
      exacte_locatie_vastgesteld: true,
      bron_locatie: 'Bestek',
      binnenstedelijk: 'Ja',
      drukke_straat_of_verkeersader: 'Nee',
      moeilijk_bereikbaar: 'Nee',
      beperkte_werkruimte: 'Nee',
      gevoelige_omgeving: 'Nee',
      contractueel_vastgestelde_locatiefeiten: [],
      externe_verificatiepunten: [],
      risicos_uit_locatieanalyse: [],
      benodigde_verificaties: [],
    },
    top5_risicos: [],
    top5_prijsverhogende_risicofactoren: [],
    top5_planningsrisicos: [],
    risicogebieden: [],
    tegenstrijdigheden: [],
    leemtes: [],
    no_go_factoren: [],
    vragen_nvi: [],
    inschrijfstrategie: {
      advies: 'inschrijfbaar_onder_voorwaarden',
      toelichting: "Mits NVI's worden beantwoord",
      belangrijkste_voorwaarden_voor_inschrijving: ['Erkenning klasse 4', 'VCA-certificering'],
      risicos_die_via_nvi_moeten_worden_opgehelderd: [],
      risicos_die_in_prijs_of_planning_moeten_worden_verwerkt: [],
      niet_acceptabele_risicos: [],
      strategische_aandachtspunten: ['Concurrent X heeft lokaal voordeel'],
      no_go_signalen: [],
    },
    gatekeeper_resultaat: {
      gatekeeper_status: 'approved',
      bronplicht_goedgekeurd: true,
      aannames_goedgekeurd: true,
      externe_bronnen_correct_gelabeld: true,
      volledigheid_goedgekeurd: true,
      consistentie_goedgekeurd: true,
      json_validatie_goedgekeurd: true,
      bevindingen: [],
    },
    ...overrides,
  }
}

describe('buildRoadmapSteps', () => {
  it('geeft altijd minimaal 1 stap terug (beslissing)', () => {
    const result = makeMinimalResult()
    const steps = buildRoadmapSteps(result)
    expect(steps.length).toBeGreaterThanOrEqual(1)
    expect(steps[steps.length - 1].id).toBe('rm-beslissing')
  })

  it('stap 1 is kritiek als er no-go factoren zijn', () => {
    const result = makeMinimalResult({
      no_go_factoren: [{ factor: 'Ontbrekende erkenning', bron: 'Bestek §3', waarom_no_go: 'Knock-out eis', kan_worden_opgelost_door: '' }],
      inschrijfstrategie: { advies: 'no_go', toelichting: '', belangrijkste_voorwaarden_voor_inschrijving: ['Erkenning klasse 6'], risicos_die_via_nvi_moeten_worden_opgehelderd: [], risicos_die_in_prijs_of_planning_moeten_worden_verwerkt: [], niet_acceptabele_risicos: [], strategische_aandachtspunten: [], no_go_signalen: [] },
    })
    const steps = buildRoadmapSteps(result)
    const gates = steps.find(s => s.id === 'rm-gates')
    expect(gates?.prioriteit).toBe('kritiek')
  })

  it('bevat NVI-stap als er vragen_nvi zijn', () => {
    const result = makeMinimalResult({
      vragen_nvi: [{
        categorie: 'juridisch',
        doel: 'Verduidelijking',
        bron: 'Bestek §7',
        formulering: 'Welke aansprakelijkheidsregeling geldt?',
        waarom_belangrijk_voor_risico: 'Aansprakelijkheid onbeperkt',
        waarom_belangrijk_voor_aanneemsom: 'Verzekeringspremie omhoog',
        waarom_belangrijk_voor_planning: 'nvt',
        gewenste_bevestiging_of_verduidelijking: 'Maximering aansprakelijkheid',
      }],
    })
    const steps = buildRoadmapSteps(result)
    expect(steps.find(s => s.id === 'rm-nvi')).toBeDefined()
  })

  it('beslissingstap is kritiek bij no_go advies', () => {
    const result = makeMinimalResult({ inschrijfadvies: 'no_go', overall_score: 'Hoog' })
    const steps = buildRoadmapSteps(result)
    const beslissing = steps.find(s => s.id === 'rm-beslissing')
    expect(beslissing?.prioriteit).toBe('kritiek')
  })

  it('beslissingstap heeft beschrijving met inschrijfadvies', () => {
    const result = makeMinimalResult({ inschrijfadvies: 'inschrijfbaar', overall_score: 'Laag' })
    const steps = buildRoadmapSteps(result)
    const beslissing = steps.find(s => s.id === 'rm-beslissing')
    expect(beslissing?.beschrijving).toContain('inschrijfbaar')
  })

  it('prijs-stap bevat top5-prijsfactoren', () => {
    const result = makeMinimalResult({
      top5_prijsverhogende_risicofactoren: [
        { factor: 'Asbestverwijdering', bron: 'Bestek', status_van_onderbouwing: 'uit stukken vastgesteld', mogelijke_prijsimpact: 'Hoog', toelichting: 'Sanering vereist', verificatie: '' },
      ],
    })
    const steps = buildRoadmapSteps(result)
    const prijs = steps.find(s => s.id === 'rm-prijs')
    expect(prijs?.items).toContain('Asbestverwijdering')
  })
})
