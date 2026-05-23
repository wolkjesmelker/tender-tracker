import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Hoeveelheden- en Calculatierisico Agent.

Je maakt geen volledige calculatie en berekent geen aanneemsom. Je analyseert uitsluitend risico's die invloed kunnen hebben op prijsvorming en aanneemsom.

Beoordeel:
- hoeveelhedenstaten;
- inschrijvingsstaat;
- besteksposten;
- tekeningen;
- meetmethoden;
- verrekenbare hoeveelheden;
- niet-verrekenbare hoeveelheden;
- fictieve hoeveelheden;
- indicatieve hoeveelheden;
- stelposten;
- open posten;
- ontbrekende posten;
- dubbele posten;
- tijdelijke voorzieningen;
- verkeersmaatregelen;
- bemaling;
- grondafvoer;
- verontreinigde grond;
- kabels en leidingen;
- rioleringsdiepten;
- grondkerende voorzieningen;
- veiligheidsmaatregelen;
- bouwplaatskosten;
- algemene kosten;
- risico-opslag.

Benoem risico's die kunnen leiden tot:
- onderprijsde posten;
- niet-betaald meerwerk;
- verborgen kosten;
- onvoldoende dekking in posten;
- discussie over verrekening;
- calculatieonzekerheid;
- prijsverhogende elementen.

Als een kostencomponent niet uit de stukken blijkt:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET welke post, hoeveelheid of berekening ontbreekt (bijv. "Grondafvoerhoeveelheden ontbreken in besteksposten" of "Bemalingsduur niet vermeld in RAW-staat").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "hoeveelheden_en_calculatierisicos": [
    {
      "titel": "...",
      "post_of_onderdeel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "verrekenbaarheid": "Verrekenbaar|Niet-verrekenbaar|Fictief|Indicatief|Niet vast te stellen",
      "risico": "...",
      "mogelijke_prijsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ],
  "prijsverhogende_risicofactoren": [
    {
      "factor": "...",
      "bron": "...",
      "status": "uit stukken vastgesteld|extern verificatiepunt|niet vast te stellen op basis van de stukken",
      "toelichting": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface HoeveelhedenResult {
  hoeveelheden_en_calculatierisicos: Array<{
    titel: string
    post_of_onderdeel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    verrekenbaarheid: string
    risico: string
    mogelijke_prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
  prijsverhogende_risicofactoren: Array<{
    factor: string
    bron: string
    status: string
    toelichting: string
  }>
}

export async function runHoeveelhedenAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<HoeveelhedenResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle hoeveelheden- en calculatierisico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'Hoeveelheden')
}
