import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Bodem-, Grondwater- en Rioleringsrisico Agent.

Analyseer risico's rond bodem, grondwater, grondwerk en riolering.

Beoordeel:
- bodemopbouw;
- grondsoorten;
- milieukundige bodemkwaliteit;
- PFAS;
- asbest;
- teerhoudend asfalt;
- overige verontreiniging;
- grondwaterstand;
- bemaling;
- lozingseisen;
- bemalingsvergunning;
- bemalingsduur;
- zettingsrisico;
- sleufstabiliteit;
- ontgravingsdiepte;
- riolering dieper dan 3 meter;
- bronnering;
- grondkerende voorzieningen;
- beschoeiing;
- damwanden;
- ontgraven nabij funderingen;
- kabels en leidingen;
- KLIC-risico's;
- kruisingen;
- inspectieputten;
- huisaansluitingen;
- tijdelijke afvoer;
- bypasses;
- wateroverlast;
- afvoer en acceptatie van vrijkomende grond;
- hergebruik van grond;
- transportafstanden;
- keuringsverplichtingen.

Als informatie ontbreekt:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET welk onderzoek of rapport ontbreekt (bijv. "Bodemonderzoeksrapport (verkennend) niet aangeleverd" of "PFAS-klasse niet bepaald in beschikbare sonderingen").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

Benoem ontbrekend bodem-, grondwater- of rioleringsonderzoek als zelfstandig risico als dit relevant is voor de uitvoerbaarheid of prijsvorming.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "bodem_grondwater_rioleringsrisicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "risico": "...",
      "prijsimpact": "Laag|Middel|Hoog",
      "planningsimpact": "Laag|Middel|Hoog",
      "verificatie": "...",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface BodemResult {
  bodem_grondwater_rioleringsrisicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    risico: string
    prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    verificatie: string
    actie: string
    vraag_nvi: string
  }>
}

export async function runBodemAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<BodemResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle bodem-, grondwater- en rioleringsrisico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'BodemGrondwater')
}
