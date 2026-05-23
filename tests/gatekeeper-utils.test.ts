import { describe, it, expect } from 'vitest'
import {
  coerceGatekeeperOutput,
  gatekeeperParseFailureOutput,
  buildGatekeeperDraftInput,
} from '../src/main/ai/risico-agents/gatekeeper-utils'

describe('coerceGatekeeperOutput', () => {
  it('vult ontbrekende boolean-velden en status', () => {
    const out = coerceGatekeeperOutput({
      gatekeeper_resultaat: {
        gatekeeper_status: 'approved',
        bronplicht_goedgekeurd: true,
        bevindingen: ['OK'],
      },
    })
    expect(out.gatekeeper_resultaat.gatekeeper_status).toBe('approved')
    expect(out.gatekeeper_resultaat.aannames_goedgekeurd).toBe(false)
    expect(out.gatekeeper_resultaat.json_validatie_goedgekeurd).toBe(false)
  })

  it('parset gecorrigeerde_strategie plat', () => {
    const out = coerceGatekeeperOutput({
      gatekeeper_resultaat: {
        gatekeeper_status: 'needs_revision',
        bronplicht_goedgekeurd: false,
        bevindingen: [],
      },
      gecorrigeerde_strategie: {
        advies: 'hoog_risico',
        toelichting: 'Aanscherping',
      },
    })
    expect(out.gecorrigeerde_strategie?.advies).toBe('hoog_risico')
    expect(out.gecorrigeerde_strategie?.toelichting).toBe('Aanscherping')
  })

  it('parset gecorrigeerde_integratie met alleen top5', () => {
    const out = coerceGatekeeperOutput({
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
      gecorrigeerde_integratie: {
        top5_risicos: [
          {
            titel: 'X',
            ernstscore: 'Hoog',
            waarom_toprisico: 'w',
            bron: 'b',
            actie: 'a',
          },
        ],
      },
    })
    expect(out.gecorrigeerde_integratie?.top5_risicos).toHaveLength(1)
  })

  it('gatekeeperParseFailureOutput is altijd bruikbaar', () => {
    const out = gatekeeperParseFailureOutput('parser fout')
    expect(out.gatekeeper_resultaat.gatekeeper_status).toBe('needs_revision')
    expect(out.gatekeeper_resultaat.bevindingen[0]).toContain('parser')
  })
})

describe('buildGatekeeperDraftInput', () => {
  it('bevat alle risicos per gebied', () => {
    const draft = {
      schema_versie: 'v2' as const,
      overall_score: 'Middel' as const,
      overall_toelichting: '',
      inschrijfadvies: 'hoog_risico' as const,
      management_samenvatting: '',
      bewijs_en_aannameregel: {
        toegepast: true,
        toelichting: '',
        niet_onderbouwde_aannames_geweigerd: true,
      },
      algemene_tenderanalyse: {
        aanbestedende_dienst: '',
        procedure: '',
        opdrachtomschrijving: '',
        contractvorm: '',
        gunningssystematiek: '',
        belangrijkste_termijnen: [],
        belangrijkste_tenderrisicos: [],
      },
      document_leesplicht_bevestiging: {
        alle_aangeleverde_documenten_geanalyseerd: true,
        toelichting: '',
        ontbrekende_of_onleesbare_documenten: [],
      },
      document_inventarisatie: [],
      locatie_en_omgevingsanalyse: {
        adres_of_werkgebied: '',
        exacte_locatie_vastgesteld: false,
        bron_locatie: '',
        binnenstedelijk: 'Niet vast te stellen' as const,
        drukke_straat_of_verkeersader: 'Niet vast te stellen' as const,
        moeilijk_bereikbaar: 'Niet vast te stellen' as const,
        beperkte_werkruimte: 'Niet vast te stellen' as const,
        gevoelige_omgeving: 'Niet vast te stellen' as const,
        contractueel_vastgestelde_locatiefeiten: [],
        externe_verificatiepunten: [],
        risicos_uit_locatieanalyse: [],
        benodigde_verificaties: [],
      },
      top5_risicos: [],
      top5_prijsverhogende_risicofactoren: [],
      top5_planningsrisicos: [],
      risicogebieden: [
        {
          naam: 'G',
          score: 'Laag' as const,
          score_toelichting: '',
          risicos: [
            {
              nummer: 1,
              titel: 'Laag risico',
              ernstscore: 'Laag' as const,
              kans: 'Laag' as const,
              impact: 'Laag' as const,
              type: 'operationeel' as const,
              feit: 'f',
              bron: 'b',
              status_van_onderbouwing: 'uit stukken vastgesteld' as const,
              professionele_duiding: '',
              juridische_duiding: '',
              waarom_risico: '',
              mogelijke_prijsimpact: 'Laag' as const,
              prijsimpact_toelichting: '',
              mogelijke_planningsimpact: 'Laag' as const,
              planningsimpact_toelichting: '',
              verificatie: '',
              actie: '',
              vraag_nvi_nodig: false,
              conceptvraag_nvi: '',
            },
          ],
        },
      ],
      tegenstrijdigheden: [],
      leemtes: [],
      no_go_factoren: [],
      vragen_nvi: [],
      inschrijfstrategie: {
        advies: 'hoog_risico' as const,
        toelichting: '',
        belangrijkste_voorwaarden_voor_inschrijving: [],
        risicos_die_via_nvi_moeten_worden_opgehelderd: [],
        risicos_die_in_prijs_of_planning_moeten_worden_verwerkt: [],
        niet_acceptabele_risicos: [],
        strategische_aandachtspunten: [],
        no_go_signalen: [],
      },
      gatekeeper_resultaat: {
        gatekeeper_status: 'needs_revision',
        bronplicht_goedgekeurd: false,
        aannames_goedgekeurd: false,
        externe_bronnen_correct_gelabeld: false,
        volledigheid_goedgekeurd: false,
        consistentie_goedgekeurd: false,
        json_validatie_goedgekeurd: false,
        bevindingen: [],
      },
    }
    const snap = buildGatekeeperDraftInput(draft) as { risicogebieden: { risicos: unknown[] }[] }
    expect(snap.risicogebieden[0]?.risicos).toHaveLength(1)
    expect(
      (snap.risicogebieden[0].risicos[0] as { titel: string }).titel,
    ).toContain('Laag risico')
  })
})
