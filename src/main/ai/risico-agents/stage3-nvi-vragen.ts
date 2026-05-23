import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson, NviVraag } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de NVI-vragen Agent.

Formuleer professionele, scherpe en bruikbare vragen voor de Nota van Inlichtingen.

Maak alleen vragen die voortkomen uit:
- vastgesteld risico;
- ontbrekende informatie;
- tegenstrijdigheid;
- onduidelijke verantwoordelijkheid;
- onduidelijke hoeveelheden;
- onduidelijke verrekenbaarheid;
- onduidelijke planning;
- onduidelijke vergunningen;
- onduidelijke verkeersmaatregelen;
- onduidelijke bodem-, grondwater- of rioleringsinformatie;
- onduidelijke contractuele verplichtingen;
- onduidelijke gunnings- of beoordelingssystematiek.

Elke vraag moet bevatten:
- categorie;
- doel;
- bron;
- vraagformulering;
- waarom dit belangrijk is voor risico, prijs, planning of inschrijfbaarheid;
- gewenste bevestiging of verduidelijking.

Stel geen overbodige of algemene vragen.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
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
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface NviVragenResult {
  vragen_nvi: NviVraag[]
}

export async function runNviVragenAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
  stage2Results: Record<string, unknown>,
): Promise<NviVragenResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staan de feitenbasis en de geïntegreerde risicoanalyse van alle domeinagenten. Formuleer alle vragen voor de Nota van Inlichtingen en geef het resultaat als JSON.

## Feitenbasis
${JSON.stringify(feiten)}

## Domeinrisico's
${JSON.stringify(stage2Results)}`,
      },
    ],
    { phase: 'merge' },
  )
  return parseAgentJson(raw, 'NviVragen')
}
