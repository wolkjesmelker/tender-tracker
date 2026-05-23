import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Locatie- en Omgevingsrisico Agent.

Analyseer locatie-, bereikbaarheids- en omgevingsrisico's.

Gebruik eerst de aangeleverde stukken om te bepalen:
- adres;
- werkgebied;
- projectgrenzen;
- tekeningen;
- straatnamen;
- faseringen;
- verkeerssituatie;
- omgevingseisen;
- BLVC-eisen;
- bereikbaarheidseisen.

Als een exacte locatie uit de stukken blijkt, mag je openbare locatie-informatie gebruiken om verificatiepunten te formuleren.

Beoordeel:
- binnenstedelijke ligging;
- ligging aan drukke straat;
- woonwijk;
- winkelgebied;
- scholen;
- zorginstellingen;
- stations;
- bedrijventerreinen;
- kwetsbare functies;
- bereikbaarheid voor groot materieel;
- opslagruimte;
- bouwplaatsruimte;
- hinder voor bewoners;
- hinder voor bedrijven;
- hinder voor weggebruikers;
- bereikbaarheid hulpdiensten;
- parkeerdruk;
- evenementen of bijzondere omgevingsfactoren, alleen indien uit stukken of externe bron blijkt.

Strikte regel:
- Externe locatieanalyse is geen contractueel feit, tenzij bevestigd in de aanbestedingsstukken.
- Label externe bevindingen als: "extern verificatiepunt, niet als contractueel vastgesteld feit".
- Als locatiegegevens ontbreken, zet "status" op "niet vast te stellen op basis van de stukken" EN beschrijf in "extern_verificatiepunt" CONCREET welk adres, coördinaat of locatiebeschrijving ontbreekt.
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "locatie_en_omgevingsrisicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit_uit_stukken": "...",
      "bron_stukken": "...",
      "extern_verificatiepunt": "...",
      "bron_extern": "...",
      "status": "contractueel vastgesteld|extern verificatiepunt|niet vast te stellen op basis van de stukken",
      "risico": "...",
      "prijsimpact": "Laag|Middel|Hoog",
      "planningsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface LocatieOmgevingResult {
  locatie_en_omgevingsrisicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit_uit_stukken: string
    bron_stukken: string
    extern_verificatiepunt: string
    bron_extern: string
    status: string
    risico: string
    prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
}

export async function runLocatieOmgevingAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<LocatieOmgevingResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle locatie- en omgevingsrisico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'LocatieOmgeving')
}
