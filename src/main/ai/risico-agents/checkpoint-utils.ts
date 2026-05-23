import type { DocumentIntakeResult } from './stage1-document-intake'
import type { TenderAnalyseResult } from './stage1-tenderanalyse'
import type { FeitenJson, RisicoAnalyseV2Result } from '../../../shared/types-risico-v2'
import type { InschrijfStrategieResult } from './stage3-inschrijfstrategie'
import type { NviVragenResult } from './stage3-nvi-vragen'
import type { RisicoIntegratieResult } from './stage3-risico-integratie'
import type { GatekeeperOutput } from './stage4-gatekeeper'
import type { DraftStage } from './riscov2-draft-assembler'

/**
 * Tussentijds opgeslagen resultaat per stage.
 * Elke stage is optioneel — aanwezigheid betekent "succesvol afgerond".
 * assembledDraft bevat altijd de meest complete definitieve JSON op dat moment.
 */
export interface RisicoV2Checkpoint {
  aanbestedingId: string
  savedAt: string
  stage1a?: {
    intakeResult: DocumentIntakeResult
    tenderResult: TenderAnalyseResult
  }
  stage1b?: {
    feiten: FeitenJson
  }
  stage2?: {
    stage2Combined: Record<string, unknown>
  }
  stage3?: {
    strategie: InschrijfStrategieResult
    nvi: NviVragenResult
    integratie: RisicoIntegratieResult
  }
  stage4a?: {
    gatekeeperOutput: GatekeeperOutput
  }
  /** Incrementeel opgebouwd rapport — altijd meest volledige versie beschikbaar. */
  assembledDraft?: RisicoAnalyseV2Result
  assembledDraftStage?: DraftStage
  assembledDraftSavedAt?: string
}

export function serializeCheckpoint(cp: RisicoV2Checkpoint): string {
  return JSON.stringify(cp)
}

export function deserializeCheckpoint(raw: string | null | undefined): RisicoV2Checkpoint | null {
  if (!raw?.trim()) return null
  try {
    return JSON.parse(raw) as RisicoV2Checkpoint
  } catch {
    return null
  }
}
