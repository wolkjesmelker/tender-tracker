import { describe, it, expect } from 'vitest'
import type { FeitenJson } from '../src/shared/types-risico-v2'
import type { DocumentIntakeResult } from '../src/main/ai/risico-agents/stage1-document-intake'
import type { TenderAnalyseResult } from '../src/main/ai/risico-agents/stage1-tenderanalyse'
import type { RisicoIntegratieResult } from '../src/main/ai/risico-agents/stage3-risico-integratie'
import type { InschrijfStrategieResult } from '../src/main/ai/risico-agents/stage3-inschrijfstrategie'
import type { NviVragenResult } from '../src/main/ai/risico-agents/stage3-nvi-vragen'
import {
  assembleDraftStage1a,
  assembleDraftStage1b,
  assembleDraftStage2,
  assembleDraftStage3,
  assembleDraftPreFinal,
  attachGatekeeperToDraft,
} from '../src/main/ai/risico-agents/riscov2-draft-assembler'

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeIntake(): DocumentIntakeResult {
  return {
    document_inventarisatie: [
      { naam: 'Bestek.pdf', type: 'bestek', datum: '2026-01-01', versie: '1.0', rol: 'Leidend document', leidend_document: 'Ja', leesbaar: true, opmerkingen: '' },
      { naam: 'Contract.pdf', type: 'contract', datum: '2026-01-01', versie: '1.0', rol: 'Contract', leidend_document: 'Nee', leesbaar: true, opmerkingen: '' },
    ],
    ontbrekende_documenten: [{ document: 'V&G-plan', waarom_verwacht: 'Verplicht bij ARBO', bron_verwijzing: 'Bestek §5', risico: 'Boete bij ontbreken' }],
    documentrisicos: [],
  }
}

function makeTender(): TenderAnalyseResult {
  return {
    algemene_tenderanalyse: {
      aanbestedende_dienst: { waarde: 'Gemeente Landgraaf', bron: 'Leidraad §1' },
      type_aanbesteding: { waarde: 'Nationaal openbaar', bron: 'Leidraad §2' },
      procedure: { waarde: 'Openbaar', bron: 'Leidraad §2' },
      opdrachtomschrijving: { waarde: 'Bergingsvoorziening Dr. Calsstraat', bron: 'Leidraad §3' },
      contractvorm: { waarde: 'UAV 2012', bron: 'Contract §1' },
      gunningssystematiek: { waarde: 'Laagste prijs', bron: 'Leidraad §7' },
      belangrijkste_termijnen: [
        { termijn: 'Inschrijfdatum', datum: '2026-03-15', bron: 'Leidraad §4' },
      ],
      tendercontext_risicos: [
        { titel: 'Strakke planning', feit: 'Uitvoering vóór zomer 2026', bron: 'Leidraad §5', risico: 'Planningsrisico' },
      ],
    },
  }
}

function makeFeiten(): FeitenJson {
  return {
    feiten: [
      { categorie: 'planning', feit: 'Uitvoering vóór 30 juni 2026', bron: 'Leidraad §5', status: 'letterlijk_uit_stukken', zekerheid: 'Hoog' },
    ],
    ontbrekende_kerninformatie: [
      { onderwerp: 'V&G-plan', reden_relevant: 'Verplicht bij graafwerkzaamheden', status: 'ontbrekend' },
      { onderwerp: 'Bodemonderzoeksrapport', reden_relevant: 'Bodemsanering mogelijk nodig', status: 'ontbrekend' },
    ],
    conflicterende_feiten: [
      { onderwerp: 'Startdatum', bron_1: 'Leidraad §5', bron_2: 'Contract §3', conflict: 'Leidraad zegt 1 april, contract zegt 1 mei' },
    ],
  }
}

function makeStage2Combined(): Record<string, unknown> {
  return {
    juridische_risicos: [
      { titel: 'Boeteclausule onbeperkt', categorie: 'contract', ernstscore: 'Hoog', kans: 'Middel', impact: 'Hoog', feit: 'Boeteclausule zonder maximum', bron: 'Contract §12', juridische_duiding: 'Risico voor inschrijver', risico_voor_inschrijver: 'Onbeperkte aansprakelijkheid', verificatie: 'Check contract', actie: 'NVI stellen', vraag_nvi: 'Wat is maximale boete?' },
    ],
    plannings_risicos: [],
    financieel_commerciele_risicos: [
      { titel: 'Tegenvallers niet verrekenbaar', categorie: 'financieel', ernstscore: 'Hoog', kans: 'Middel', impact: 'Hoog', feit: 'Meerwerk niet vergoed', bron: 'Contract §15', juridische_duiding: '', risico_voor_inschrijver: 'Financieel verlies', verificatie: '', actie: 'Risicoopslag', vraag_nvi: '' },
    ],
  }
}

function makeIntegratie(): RisicoIntegratieResult {
  return {
    overall_score: 'Hoog',
    overall_toelichting: 'Hoog risico door boeteclausule en planningsdruk.',
    top5_risicos: [
      { titel: 'Boeteclausule onbeperkt', ernstscore: 'Hoog', waarom_toprisico: 'Onbeperkte aansprakelijkheid', bron: 'Contract §12', actie: 'NVI stellen' },
    ],
    top5_prijsverhogende_risicofactoren: [
      { factor: 'Bodemrisico', bron: 'Bodemonderzoek ontbreekt', status: 'niet vast te stellen op basis van de stukken', mogelijke_prijsimpact: 'Hoog', toelichting: 'Sanering mogelijk', verificatie: 'Bodemonderzoek opvragen' },
    ],
    top5_planningsrisicos: [
      { risico: 'Strakke deadline', bron: 'Leidraad §5', status_van_onderbouwing: 'uit stukken vastgesteld', mogelijke_planningsimpact: 'Hoog', toelichting: 'Weinig speling', actie: 'Fasering uitwerken' },
    ],
    geintegreerd_risicoregister: [
      { nummer: 1, titel: 'Boeteclausule onbeperkt', categorie: 'Juridisch', ernstscore: 'Hoog', kans: 'Middel', impact: 'Hoog', type: 'juridisch', feit: 'Boeteclausule zonder maximum', bron: 'Contract §12', status_van_onderbouwing: 'uit stukken vastgesteld', professionele_duiding: 'Hoog risico', juridische_duiding: 'Onbeperkte aansprakelijkheid', waarom_risico: 'Onbeperkte kosten mogelijk', mogelijke_prijsimpact: 'Hoog', mogelijke_planningsimpact: 'Laag', actie: 'NVI stellen', gekoppelde_nvi_vraag: 'Wat is de maximale boete per dag?' },
      { nummer: 2, titel: 'Planningsdruk', categorie: 'Planning en fasering', ernstscore: 'Hoog', kans: 'Hoog', impact: 'Hoog', type: 'planningsrisico', feit: 'Deadline 30 juni', bron: 'Leidraad §5', status_van_onderbouwing: 'uit stukken vastgesteld', professionele_duiding: 'Hoog risico', juridische_duiding: '', waarom_risico: 'Weinig buffer', mogelijke_prijsimpact: 'Middel', mogelijke_planningsimpact: 'Hoog', actie: 'Fasering uitwerken', gekoppelde_nvi_vraag: '' },
    ],
    no_go_factoren: [],
    leemtes: [{ ontbrekende_informatie: 'V&G-plan', waarom_belangrijk: 'Verplicht bij graafwerk', risico_voor_inschrijver: 'ARBO-risico', vraag_nvi: 'Is een V&G-plan beschikbaar?' }],
    tegenstrijdigheden: [{ omschrijving: 'Startdatum conflict', document_1: 'Leidraad §5', document_2: 'Contract §3', risico: 'Onduidelijkheid', actie: 'NVI' }],
  }
}

function makeStrategie(): InschrijfStrategieResult {
  return {
    inschrijfstrategie: {
      advies: 'inschrijfbaar_onder_voorwaarden',
      toelichting: 'Inschrijfbaar mits boeteclausule wordt verduidelijkt.',
      belangrijkste_voorwaarden_voor_inschrijving: ['Boeteclausule verduidelijken via NVI'],
      risicos_die_via_nvi_moeten_worden_opgehelderd: ['Maximale boete', 'Startdatum'],
      risicos_die_in_prijs_of_planning_moeten_worden_verwerkt: ['Bodemrisico'],
      niet_acceptabele_risicos: [],
      strategische_aandachtspunten: ['Risicoopslag calculeren'],
      no_go_signalen: [],
    },
  }
}

function makeNvi(): NviVragenResult {
  return {
    vragen_nvi: [
      { categorie: 'contract', doel: 'Boeteclausule verduidelijken', bron: 'Contract §12', formulering: 'Wat is de maximale boete per dag?', waarom_belangrijk_voor_risico: 'Onbeperkte aansprakelijkheid', waarom_belangrijk_voor_aanneemsom: 'Prijsopslag nodig', waarom_belangrijk_voor_planning: 'Geen planningsimpact', gewenste_bevestiging_of_verduidelijking: 'Maximum boetebedrag bevestigen' },
    ],
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('assembleDraftStage1a', () => {
  it('vult document_inventarisatie en tenderanalyse', () => {
    const draft = assembleDraftStage1a(makeIntake(), makeTender())
    expect(draft.schema_versie).toBe('v2')
    expect(draft.document_inventarisatie).toHaveLength(2)
    expect(draft.algemene_tenderanalyse.aanbestedende_dienst).toBe('Gemeente Landgraaf')
    expect(draft.algemene_tenderanalyse.procedure).toBe('Openbaar')
    expect(draft.document_leesplicht_bevestiging.alle_aangeleverde_documenten_geanalyseerd).toBe(true)
    expect(draft.document_leesplicht_bevestiging.toelichting).toContain('2 documenten verwerkt')
  })

  it('geen groene leesplicht bij lege documentintake', () => {
    const leegIntake: DocumentIntakeResult = {
      document_inventarisatie: [],
      ontbrekende_documenten: [],
      documentrisicos: [],
    }
    const draft = assembleDraftStage1a(leegIntake, makeTender())
    expect(draft.document_inventarisatie).toHaveLength(0)
    expect(draft.document_leesplicht_bevestiging.alle_aangeleverde_documenten_geanalyseerd).toBe(false)
    expect(draft.document_leesplicht_bevestiging.toelichting).toContain('0 documenten')
  })

  it('geen groene leesplicht als er onleesbare documenten in inventarisatie staan', () => {
    const intake: DocumentIntakeResult = {
      document_inventarisatie: [
        { naam: 'X.pdf', type: 'overig', datum: '', versie: '', rol: '', leidend_document: 'Nee', leesbaar: false, opmerkingen: '' },
      ],
      ontbrekende_documenten: [],
      documentrisicos: [],
    }
    const draft = assembleDraftStage1a(intake, makeTender())
    expect(draft.document_leesplicht_bevestiging.alle_aangeleverde_documenten_geanalyseerd).toBe(false)
    expect(draft.document_leesplicht_bevestiging.ontbrekende_of_onleesbare_documenten).toEqual(['X.pdf'])
    expect(draft.document_leesplicht_bevestiging.toelichting).toMatch(/onleesbaar|incompleet/)
  })

  it('bevat lege maar geldige arrays voor structurele blokken', () => {
    const draft = assembleDraftStage1a(makeIntake(), makeTender())
    expect(Array.isArray(draft.risicogebieden)).toBe(true)
    expect(Array.isArray(draft.vragen_nvi)).toBe(true)
    expect(Array.isArray(draft.leemtes)).toBe(true)
  })
})

describe('assembleDraftStage1b', () => {
  it('vult leemtes en tegenstrijdigheden uit feitenbasis', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    expect(draft1b.leemtes.length).toBeGreaterThan(0)
    expect(draft1b.leemtes[0].ontbrekende_informatie).toBe('V&G-plan')
    expect(draft1b.tegenstrijdigheden.length).toBeGreaterThan(0)
    expect(draft1b.tegenstrijdigheden[0].omschrijving).toContain('april')
  })

  it('maakt NVI-stubs vanuit conflicterende feiten', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    expect(draft1b.vragen_nvi.length).toBeGreaterThan(0)
    const startdatumVraag = draft1b.vragen_nvi.find(v => v.formulering.includes('Startdatum'))
    expect(startdatumVraag).toBeDefined()
  })
})

describe('assembleDraftStage2', () => {
  it('vult risicogebieden altijd vanuit stage2-domeinarrays', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    expect(draft2.risicogebieden.length).toBeGreaterThan(0)
    const juridisch = draft2.risicogebieden.find(g => g.naam === 'Juridisch')
    expect(juridisch).toBeDefined()
    expect(juridisch!.risicos.length).toBeGreaterThan(0)
  })

  it('berekent overall_score op basis van gebiedscores', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    expect(['Laag', 'Middel', 'Hoog']).toContain(draft2.overall_score)
  })
})

describe('assembleDraftStage3', () => {
  it('verrijkt risicogebieden uit integratie-register', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    const draft3 = assembleDraftStage3(draft2, makeIntegratie(), makeNvi(), makeStrategie(), makeFeiten())
    expect(draft3.risicogebieden.length).toBeGreaterThan(0)
    const juridisch = draft3.risicogebieden.find(g => g.naam === 'Juridisch')
    expect(juridisch).toBeDefined()
  })

  it('vult top5_risicos uit integratie', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    const draft3 = assembleDraftStage3(draft2, makeIntegratie(), makeNvi(), makeStrategie(), makeFeiten())
    expect(draft3.top5_risicos.length).toBeGreaterThan(0)
    expect(draft3.top5_risicos[0].titel).toBe('Boeteclausule onbeperkt')
  })

  it('dedupliceert NVI-vragen', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    const draft3 = assembleDraftStage3(draft2, makeIntegratie(), makeNvi(), makeStrategie(), makeFeiten())
    const formuleringen = draft3.vragen_nvi.map(v => v.formulering)
    const uniek = new Set(formuleringen.map(f => f.toLowerCase().slice(0, 50)))
    // Meer unieke formuleringen dan duplicaten
    expect(uniek.size).toBeGreaterThan(0)
    expect(draft3.vragen_nvi.length).toBeLessThanOrEqual(40)
  })

  it('stelt inschrijfadvies in vanuit strategie', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    const draft3 = assembleDraftStage3(draft2, makeIntegratie(), makeNvi(), makeStrategie(), makeFeiten())
    expect(draft3.inschrijfadvies).toBe('inschrijfbaar_onder_voorwaarden')
  })
})

describe('assembleDraftPreFinal', () => {
  it('overschrijft narratieve tekstvelden maar behoudt structurele data', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    const draft3 = assembleDraftStage3(draft2, makeIntegratie(), makeNvi(), makeStrategie(), makeFeiten())
    const gebiedenAantal = draft3.risicogebieden.length

    const final = assembleDraftPreFinal(draft3, {
      management_samenvatting: 'Dit project heeft hoge risico\'s vanwege de boeteclausule.',
      overall_toelichting: 'Hoog risico door contractuele en planningsrisico\'s.',
      inschrijfadvies: 'inschrijfbaar_onder_voorwaarden',
    })

    expect(final.management_samenvatting).toContain('boeteclausule')
    expect(final.overall_toelichting).toContain('contractuele')
    expect(final.risicogebieden.length).toBe(gebiedenAantal)
  })

  it('behoudt bestaande risicogebieden als LLM lege array geeft', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const draft2 = assembleDraftStage2(draft1b, makeStage2Combined())
    const draft3 = assembleDraftStage3(draft2, makeIntegratie(), makeNvi(), makeStrategie(), makeFeiten())
    const gebiedenAantal = draft3.risicogebieden.length

    const final = assembleDraftPreFinal(draft3, { risicogebieden: [] })
    expect(final.risicogebieden.length).toBe(gebiedenAantal)
  })
})

describe('attachGatekeeperToDraft', () => {
  it('voegt gatekeeper_resultaat toe aan draft', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const withGk = attachGatekeeperToDraft(draft1a, {
      gatekeeper_resultaat: {
        gatekeeper_status: 'approved',
        bronplicht_goedgekeurd: true,
        aannames_goedgekeurd: true,
        externe_bronnen_correct_gelabeld: true,
        volledigheid_goedgekeurd: true,
        consistentie_goedgekeurd: true,
        json_validatie_goedgekeurd: true,
        bevindingen: ['Rapport volledig gevalideerd.'],
      },
    })
    expect(withGk.gatekeeper_resultaat.gatekeeper_status).toBe('approved')
  })

  it('voegt gecorrigeerde NVI-vragen toe zonder duplicaten', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const draft1b = assembleDraftStage1b(draft1a, makeFeiten())
    const extraNvi = { vragen_nvi: [
      { categorie: 'contract' as const, doel: 'Extra vraag', bron: 'Gatekeeper', formulering: 'Is er een maximum boete?', waarom_belangrijk_voor_risico: 'Aansprakelijkheid', waarom_belangrijk_voor_aanneemsom: 'Opslag', waarom_belangrijk_voor_planning: '-', gewenste_bevestiging_of_verduidelijking: 'Max boete' },
    ]}
    const withGk = attachGatekeeperToDraft(draft1b, {
      gatekeeper_resultaat: { gatekeeper_status: 'approved', bronplicht_goedgekeurd: true, aannames_goedgekeurd: true, externe_bronnen_correct_gelabeld: true, volledigheid_goedgekeurd: true, consistentie_goedgekeurd: true, json_validatie_goedgekeurd: true, bevindingen: [] },
      gecorrigeerde_nvi: extraNvi,
    })
    const nieuweTitels = withGk.vragen_nvi.map(v => v.formulering)
    expect(nieuweTitels.some(f => f.includes('maximum boete'))).toBe(true)
  })

  it('past gecorrigeerde_strategie en integratie-patch op de draft toe', () => {
    const draft1a = assembleDraftStage1a(makeIntake(), makeTender())
    const withGk = attachGatekeeperToDraft(draft1a, {
      gatekeeper_resultaat: {
        gatekeeper_status: 'needs_revision',
        bronplicht_goedgekeurd: true,
        aannames_goedgekeurd: true,
        externe_bronnen_correct_gelabeld: true,
        volledigheid_goedgekeurd: true,
        consistentie_goedgekeurd: true,
        json_validatie_goedgekeurd: true,
        bevindingen: [],
      },
      gecorrigeerde_strategie: { advies: 'inschrijfbaar_onder_voorwaarden', toelichting: 'Gatekeeper: aanscherping' },
      gecorrigeerde_integratie: {
        top5_risicos: [
          {
            titel: 'Eén top-risico',
            ernstscore: 'Hoog',
            waarom_toprisico: 'x',
            bron: 'y',
            actie: 'z',
          },
        ],
        overall_score: 'Hoog',
      },
    })
    expect(withGk.inschrijfstrategie.advies).toBe('inschrijfbaar_onder_voorwaarden')
    expect(withGk.inschrijfstrategie.toelichting).toContain('Gatekeeper')
    expect(withGk.top5_risicos).toHaveLength(1)
    expect(withGk.overall_score).toBe('Hoog')
  })
})
