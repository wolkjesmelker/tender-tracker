import { registerTenderHandlers } from './tenders.ipc'
import { registerSourceHandlers } from './sources.ipc'
import { registerCriteriaHandlers } from './criteria.ipc'
import { registerZoektermenHandlers } from './zoektermen.ipc'
import { registerAIVragenHandlers } from './ai-vragen.ipc'
import { registerAIPromptsHandlers } from './ai-prompts.ipc'
import { registerScrapingHandlers } from './scraping.ipc'
import { registerAuthHandlers } from './auth.ipc'
import { registerAnalysisHandlers } from './analysis.ipc'
import { registerExportHandlers } from './export.ipc'
import { registerSettingsHandlers } from './settings.ipc'
import { registerSchedulerHandlers } from './scheduler.ipc'
import { registerAppHandlers } from './app.ipc'
import { registerRisicoHandlers } from './risico.ipc'
import { registerTokenHandlers } from './tokens.ipc'
import { registerBackupHandlers } from './backup.ipc'
import { registerDiagnosticsHandlers } from './diagnostics.ipc'
import { registerAgentHandlers } from './agent.ipc'
import { registerBedrijfsprofielHandlers } from './bedrijfsprofiel.ipc'

export function registerAllHandlers(): void {
  registerAppHandlers()
  registerTenderHandlers()
  registerSourceHandlers()
  registerCriteriaHandlers()
  registerZoektermenHandlers()
  registerAIVragenHandlers()
  registerAIPromptsHandlers()
  registerScrapingHandlers()
  registerAuthHandlers()
  registerAnalysisHandlers()
  registerExportHandlers()
  registerSettingsHandlers()
  registerSchedulerHandlers()
  registerRisicoHandlers()
  registerTokenHandlers()
  registerBackupHandlers()
  registerDiagnosticsHandlers()
  registerAgentHandlers()
  registerBedrijfsprofielHandlers()
}
