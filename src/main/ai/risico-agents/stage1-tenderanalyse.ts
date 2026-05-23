import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'

const SYSTEM = `Je bent de Tenderanalyse Agent.

Maak een algemene tenderanalyse op basis van de aangeleverde stukken.

Analyseer:
- aanbestedende dienst;
- type aanbesteding;
- procedure;
- opdrachtomschrijving;
- contractvorm;
- toepasselijke voorwaarden;
- gunningssystematiek;
- indieningsvereisten;
- looptijd;
- uitvoeringsperiode;
- globale scope;
- kernverplichtingen;
- hoofdtermijnen;
- hoofddocumenten;
- documenthiërarchie;
- belangrijkste tenderstructuur.

Deze analyse is bedoeld als context voor de risicoanalyse. Maak geen aannames. Vul niets aan op basis van marktkennis.

Als informatie ontbreekt, schrijf: "niet vast te stellen op basis van de stukken".

Geef per belangrijk feit een bron.

Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface TenderAnalyseResult {
  algemene_tenderanalyse: {
    aanbestedende_dienst: { waarde: string; bron: string }
    type_aanbesteding: { waarde: string; bron: string }
    procedure: { waarde: string; bron: string }
    opdrachtomschrijving: { waarde: string; bron: string }
    contractvorm: { waarde: string; bron: string }
    gunningssystematiek: { waarde: string; bron: string }
    belangrijkste_termijnen: Array<{ termijn: string; datum: string; bron: string }>
    tendercontext_risicos: Array<{ titel: string; feit: string; bron: string; risico: string }>
  }
}

export async function runTenderAnalyseAgent(
  chatFn: RisicoChatFn,
  documentTexts: string,
): Promise<TenderAnalyseResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staan alle aanbestedingsdocumenten. Maak een volledige tenderanalyse en geef het resultaat als JSON.\n\n${documentTexts}`,
      },
    ],
    { phase: 'single' },
  )
  return parseAgentJson(raw, 'Tenderanalyse')
}
