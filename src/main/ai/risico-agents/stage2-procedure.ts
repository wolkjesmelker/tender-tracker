import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'
import type { FeitenJson } from '../../../shared/types-risico-v2'

const SYSTEM = `Je bent de Procedure Agent.

Analyseer procedurele en formele risico's.

Beoordeel:
- indieningsdeadline;
- indieningsplatform;
- vereiste documenten;
- ondertekening;
- UEA;
- verklaringen;
- referenties;
- bewijsstukken;
- knock-out-eisen;
- vormvereisten;
- vraagtermijnen;
- Nota van Inlichtingen-termijnen;
- rechtsbeschermingstermijnen;
- gestanddoening;
- geldigheid van inschrijving;
- combinaties en onderaanneming;
- sancties bij ontbrekende stukken.

Noem elk procedureel risico dat kan leiden tot:
- uitsluiting;
- ongeldige inschrijving;
- herstelmogelijkheid of juist geen herstelmogelijkheid;
- verlies van rechten;
- beoordelingsnadeel.

Gebruik alleen bronnen uit de stukken.

Als een procedureel vereiste niet uit de stukken valt te herleiden:
- Zet "status_van_onderbouwing" op "niet vast te stellen op basis van de stukken" of "conflicterend in stukken".
- Beschrijf in "verificatie" CONCREET welke eis, termijn of verplichting ontbreekt (bijv. "Gestanddoeningstermijn niet vermeld in aankondiging" of "UEA-vereiste onduidelijk in selectieleidraad").
- Noem NOOIT alleen de generieke statuszin zonder te zeggen WAT er ontbreekt.

BELANGRIJK: Gebruik UITSLUITEND de onderstaande Nederlandse veldnamen. Gebruik NOOIT Engelse veldnamen.
Geef je antwoord als JSON met exact dit schema:
{
  "procedurele_risicos": [
    {
      "titel": "...",
      "type": "knock-out|bewijsrisico|procedureel|strategisch",
      "ernstscore": "Laag|Middel|Hoog",
      "feit": "...",
      "bron": "...",
      "status_van_onderbouwing": "uit stukken vastgesteld|niet vast te stellen op basis van de stukken|conflicterend in stukken",
      "verificatie": "...",
      "waarom_risico": "...",
      "actie": "...",
      "vraag_nvi": "..."
    }
  ]
}
Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface ProcedureResult {
  procedurele_risicos: Array<{
    titel: string
    type: string
    ernstscore: 'Laag' | 'Middel' | 'Hoog'
    feit: string
    bron: string
    waarom_risico: string
    actie: string
    vraag_nvi: string
  }>
}

export async function runProcedureAgent(
  chatFn: RisicoChatFn,
  feiten: FeitenJson,
): Promise<ProcedureResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staat de geëxtraheerde feitenbasis. Analyseer alle procedurele en formele risico's en geef het resultaat als JSON.\n\n${JSON.stringify(feiten)}`,
      },
    ],
    { phase: 'extract' },
  )
  return parseAgentJson(raw, 'ProcedureCompliance')
}
