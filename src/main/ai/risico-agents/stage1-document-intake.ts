import { parseAgentJson } from './agent-utils'
import type { RisicoChatFn } from '../risico-analysis'

const SYSTEM = `Je bent de Document Intake Agent.

Analyseer uitsluitend de aangeleverde documentenset. Maak een volledige documentinventarisatie.

Controleer:
- documentnaam;
- documenttype;
- datum;
- versie;
- status;
- rol in de aanbesteding;
- of het document leidend lijkt;
- of het document een bijlage is;
- of het document onleesbaar of incompleet is;
- of er documenten ontbreken waarnaar wordt verwezen;
- of er meerdere versies van hetzelfde document aanwezig zijn;
- of er nota's van inlichtingen zijn;
- of er een documenthiërarchie is.

Maak geen inhoudelijke risicoanalyse, behalve wanneer een document ontbreekt, onleesbaar is of conflicterende versies bestaan. Dat mag als documentrisico worden benoemd.

Gebruik geen aannames. Als iets niet blijkt, schrijf: "niet vast te stellen op basis van de stukken".

Geef je antwoord UITSLUITEND als valide JSON zonder markdown, codeblokken of extra tekst.`

export interface DocumentIntakeResult {
  document_inventarisatie: Array<{
    naam: string
    type: 'leidraad' | 'bestek' | 'contract' | 'tekening' | 'staat' | 'bijlage' | 'nota_van_inlichtingen' | 'planning' | 'rapport' | 'formulier' | 'overig'
    datum: string
    versie: string
    rol: string
    leidend_document: 'Ja' | 'Nee' | 'Niet vast te stellen'
    leesbaar: boolean
    opmerkingen: string
  }>
  ontbrekende_documenten: Array<{
    document: string
    waarom_verwacht: string
    bron_verwijzing: string
    risico: string
  }>
  documentrisicos: Array<{
    titel: string
    feit: string
    bron: string
    risico: string
    actie: string
  }>
}

export async function runDocumentIntakeAgent(
  chatFn: RisicoChatFn,
  documentTexts: string,
): Promise<DocumentIntakeResult> {
  const raw = await chatFn(
    [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Hieronder staan alle aanbestedingsdocumenten. Maak een volledige documentinventarisatie en geef het resultaat als JSON.\n\n${documentTexts}`,
      },
    ],
    { phase: 'single' },
  )
  return parseAgentJson(raw, 'DocumentIntake')
}
