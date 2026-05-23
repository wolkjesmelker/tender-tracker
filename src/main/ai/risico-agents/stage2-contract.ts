import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Contractrisico Agent.

Analyseer contractuele risico's op basis van de contractstukken.

Beoordeel:
- toepasselijke voorwaarden;
- contracthiërarchie;
- UAV/UAV-GC/RAW of andere voorwaarden;
- ontwerpverantwoordelijkheid;
- waarschuwingsplicht;
- resultaatsverplichtingen;
- aansprakelijkheidslimieten;
- boetes;
- garanties;
- onderhoudsverplichtingen;
- verzekeringen;
- zekerheden;
- betalingstermijnen;
- prijsindexatie;
- meerwerkregeling;
- wijzigingsprocedure;
- oplevering;
- vertraging;
- opschorting;
- beëindiging;
- geschillen;
- risico-overdracht naar aannemer.

Benoem alleen contractuele risico's die uit de stukken blijken. Als de regeling ontbreekt, label dit als leemte of verificatiepunt.

Als een conclusie niet volledig uit de stukken kan worden onderbouwd:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET welk specifiek gegeven of welke passage ontbreekt (bijv. "Aansprakelijkheidsregeling ontbreekt in UAV-GC bijlage" of "Meerwerkregeling niet gedefinieerd in bestek").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "contractuele_risicos": [
    {
      "titel": "...",
      "ernstscore": "Laag|Middel|Hoog",
      "kans": "Laag|Middel|Hoog",
      "impact": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "contractuele_duiding": "...",
      "risico_voor_inschrijver": "...",
      "mogelijke_prijsimpact": "Laag|Middel|Hoog",
      "mogelijke_planningsimpact": "Laag|Middel|Hoog",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface ContractRisicoResult {
  contractuele_risicos: Array<{
    titel: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    kans: 'Laag' | 'Middel' | 'Hoog'
    impact: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    contractuele_duiding: string
    risico_voor_inschrijver: string
    mogelijke_prijsimpact: 'Laag' | 'Middel' | 'Hoog'
    mogelijke_planningsimpact: 'Laag' | 'Middel' | 'Hoog'
    actie: string
    vraag_nvi: string
  }>
}

export async function runContractRisicoAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<ContractRisicoResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle contractuele risico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'ContractRisico')
}
