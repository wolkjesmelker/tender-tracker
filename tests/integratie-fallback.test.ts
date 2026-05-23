import { describe, it, expect } from 'vitest'
import { buildIntegratieFallbackFromDraft } from '../src/main/ai/risico-agents/integratie-fallback'
import type { FeitenJson, RisicoAnalyseV2Result } from '../src/shared/types-risico-v2'

describe('buildIntegratieFallbackFromDraft', () => {
  it('bouwt register en overall uit stage-2 draft', () => {
    const draft: RisicoAnalyseV2Result = {
      schema_versie: 'v2',
      overall_score: 'Middel',
      overall_toelichting: '',
      inschrijfadvies: 'hoog_risico',
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
        binnenstedelijk: 'Niet vast te stellen',
        drukke_straat_of_verkeersader: 'Niet vast te stellen',
        moeilijk_bereikbaar: 'Niet vast te stellen',
        beperkte_werkruimte: 'Niet vast te stellen',
        gevoelige_omgeving: 'Niet vast te stellen',
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
          naam: 'Testgebied',
          score: 'Hoog',
          score_toelichting: '',
          risicos: [
            {
              nummer: 1,
              titel: 'R1',
              ernstscore: 'Hoog',
              kans: 'Middel',
              impact: 'Hoog',
              type: 'commercieel',
              feit: 'F',
              bron: 'B',
              status_van_onderbouwing: 'uit stukken vastgesteld',
              professionele_duiding: '',
              juridische_duiding: '',
              waarom_risico: 'W',
              mogelijke_prijsimpact: 'Hoog',
              prijsimpact_toelichting: '',
              mogelijke_planningsimpact: 'Laag',
              planningsimpact_toelichting: '',
              verificatie: '',
              actie: 'A',
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
        advies: 'hoog_risico',
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
        json_validatie_goedgekeurd: true,
        bevindingen: [],
      },
    }
    const feiten: FeitenJson = { feiten: [], ontbrekende_kerninformatie: [], conflicterende_feiten: [] }
    const integ = buildIntegratieFallbackFromDraft(draft, feiten)
    expect(integ.overall_score).toBe('Hoog')
    expect(integ.geintegreerd_risicoregister).toHaveLength(1)
    expect(integ.top5_risicos[0]?.titel).toBe('R1')
  })
})
