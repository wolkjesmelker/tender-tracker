import log from 'electron-log'
import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import {
  buildGatekeeperDraftInput,
  coerceGatekeeperOutput,
  gatekeeperParseFailureOutput,
  type GatekeeperInput,
  type GatekeeperOutput,
} from './gatekeeper-utils'

export type { GatekeeperInput, GatekeeperOutput }

const SYSTEM = `Je bent de Gatekeeper Agent.

Je ontvangt het bijna-definitieve risicorapport ("assembledDraft") dat door alle voorgaande agents is opgebouwd.
Dit is het rapport dat de gebruiker zal zien. Alle risico's per gebied staan in "risicogebieden" met volledige lijst "risicos" (inclusief Laag/Middel/Hoog).

Controleer strikt op basis van het aangeleverde rapport:

1. Bronplicht: elk feit/risico heeft bron of status "niet vast te stellen op basis van de stukken"; externe punten correct gelabeld.
2. Geen aannames: geen ononderbouwde feiten; signalen als "waarschijnlijk" zonder verificatiepad.
3. Volledigheid: risicogebieden, leemtes, tegenstrijdigheden, NVI waar nodig.
4. Consistentie: ernst/kans/impact; inschrijfadvies vs risico's; no-go's onderbouwd; top 5 vs gebieden.
5. NVI-kwaliteit: concreet, niet dubbel, dekt onzekerheden.

REGELS:
- Je bedenkt GEEN nieuwe inhoudelijke risico's of feiten.
- Je vult alleen ontbrekende NVI/leemtes aan als ze rechtstreeks uit de aangeleverde data volgen.
- Optioneel: gecorrigeerde_strategie en gecorrigeerde_integratie alleen als je bestaande teksten/lijsten wilt aanscherpen (geen nieuwe feiten).

Geef UITSLUITEND JSON volgens exact dit schema (null weglaten voor optionele onderdelen):
{
  "gatekeeper_resultaat": {
    "gatekeeper_status": "approved"|"rejected"|"needs_revision",
    "bronplicht_goedgekeurd": true|false,
    "aannames_goedgekeurd": true|false,
    "externe_bronnen_correct_gelabeld": true|false,
    "volledigheid_goedgekeurd": true|false,
    "consistentie_goedgekeurd": true|false,
    "json_validatie_goedgekeurd": true|false,
    "bevindingen": ["korte string per bevinding"]
  },
  "gecorrigeerde_nvi": null | {
    "vragen_nvi": [
      {
        "categorie": "juridisch|financieel|uitvoering|planning|hoeveelheden|bodem|grondwater|riolering|verkeer|omgeving|vergunningen|veiligheid|contract|gunning|procedure",
        "doel": "...",
        "bron": "...",
        "formulering": "...",
        "waarom_belangrijk_voor_risico": "...",
        "waarom_belangrijk_voor_aanneemsom": "...",
        "waarom_belangrijk_voor_planning": "...",
        "gewenste_bevestiging_of_verduidelijking": "..."
      }
    ]
  },
  "gecorrigeerde_strategie": null | {
    "advies": "inschrijfbaar|inschrijfbaar_onder_voorwaarden|hoog_risico|no_go",
    "toelichting": "...",
    "belangrijkste_voorwaarden_voor_inschrijving": ["..."],
    "risicos_die_via_nvi_moeten_worden_opgehelderd": ["..."],
    "risicos_die_in_prijs_of_planning_moeten_worden_verwerkt": ["..."],
    "niet_acceptabele_risicos": ["..."],
    "strategische_aandachtspunten": ["..."],
    "no_go_signalen": ["..."]
  },
  "gecorrigeerde_integratie": null | {
    "top5_risicos": [{"titel":"...","ernstscore":"Laag"|"Middel"|"Hoog","waarom_toprisico":"...","bron":"...","actie":"..."}],
    "top5_prijsverhogende_risicofactoren": [{"factor":"...","bron":"...","status":"...","mogelijke_prijsimpact":"Laag"|"Middel"|"Hoog","toelichting":"...","verificatie":"..."}],
    "top5_planningsrisicos": [{"risico":"...","bron":"...","status_van_onderbouwing":"uit stukken vastgesteld|uit externe bron vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken","mogelijke_planningsimpact":"Laag"|"Middel"|"Hoog","toelichting":"...","actie":"..."}],
    "leemtes": [{"ontbrekende_informatie":"...","waarom_belangrijk":"...","risico_voor_inschrijver":"...","vraag_nvi":"..."}],
    "tegenstrijdigheden": [{"omschrijving":"...","document_1":"...","document_2":"...","risico":"...","actie":"..."}],
    "no_go_factoren": [{"factor":"...","bron":"...","waarom_no_go":"...","kan_worden_opgelost_door":"..."}],
    "overall_score": "Laag"|"Middel"|"Hoog",
    "overall_toelichting": "..."
  }
}

Gebruik voor status_van_onderbouwing exact (inclusief spelling): "uit stukken vastgesteld", "uit externe bron vastgesteld", "niet vast te stellen op basis van de stukken", "conflicterend in stukken".
Geen markdown, geen codeblokken, geen tekst buiten JSON.`

export async function runGatekeeperAgent(
  chatFn: RisicoChatFn,
  input: GatekeeperInput,
): Promise<GatekeeperOutput> {
  const draftInput = input.assembledDraft
    ? buildGatekeeperDraftInput(input.assembledDraft)
    : {
        intakeResult: input.intakeResult,
        tenderResult: input.tenderResult,
        feiten: input.feiten,
        stage2Results: input.stage2Results,
        strategie: input.strategie,
        nvi: input.nvi,
        integratie: input.integratie,
      }

  try {
    const raw = await chatFn(
      [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: `Valideer het onderstaande tender- en risicorapport. Gebruik exact het JSON-schema uit de system instructie.

## Rapport voor validatie
${JSON.stringify(draftInput)}`,
        },
      ],
      { phase: 'merge' },
    )
    const parsed = parseAgentJson<unknown>(raw, 'Gatekeeper')
    return coerceGatekeeperOutput(parsed)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    log.warn('[gatekeeper] parse/call mislukt — veilig fallback-resultaat:', msg)
    return gatekeeperParseFailureOutput(msg)
  }
}
