import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Financieel-Commercieel Risico Agent.

Analyseer financiële en commerciële risico's.

Beoordeel:
- prijsindexatie;
- betalingsvoorwaarden;
- betalingstermijnen;
- liquiditeitsrisico;
- bankgaranties;
- zekerheden;
- verzekeringen;
- boetes;
- bonus/malus;
- verrekenbaarheid;
- stelposten;
- hoeveelheidsafwijkingen;
- niet-betaald meerwerk;
- plafondbedragen;
- abnormaal lage inschrijving;
- risicodragende verplichtingen;
- lange gestanddoening;
- prijsstijgingsrisico;
- commerciële haalbaarheid;
- marge- en risico-opslaggevoeligheid.

Maak geen volledige financiële berekening. Benoem alleen risico's en prijsgevoelige elementen.

Als een financieel gegeven niet uit de stukken valt te herleiden:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET welk bedrag, regeling of passage ontbreekt (bijv. "Prijsindexatieformule ontbreekt in bestek" of "Bankgarantiepercentage niet vermeld").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "financieel_commerciele_risicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "risico": "...",
      "mogelijke_prijsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface FinancieelResult {
  financieel_commerciele_risicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    risico: string
    mogelijke_prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
}

export async function runFinancieelAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<FinancieelResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle financieel-commerciële risico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'Financieel')
}
