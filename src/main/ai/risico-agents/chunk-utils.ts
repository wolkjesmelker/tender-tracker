import type { FeitenJson } from '../../../shared/types-risico-v2'
import type { DocumentIntakeResult } from './stage1-document-intake'
import type { TenderAnalyseResult } from './stage1-tenderanalyse'

/**
 * Maximale grootte van één chunk in tekens.
 * ~110 K tekens ≈ 27 K tokens — veilig voor alle modellen (Kimi 128K, OpenAI 128K, Claude 200K).
 * Laat ruimte voor systeem-prompt (~2 K tokens), manifest (~3 K tokens) en response (~5 K tokens).
 */
export const CHUNK_MAX_CHARS = 110_000

/**
 * Ruime chunk-limieten voor modellen met grotere context-vensters.
 * Gebruik ~4 tekens/token als richtlijn voor Nederlands tekst.
 *
 * Gemini 2.5 Flash: 1 M tokens context — gebruik max 900 K tokens invoer
 *   → 3 500 000 tekens. In de praktijk passen alle maar de grootste dossiers in één chunk.
 *
 * Claude 200 K context — gebruik max 175 K tokens invoer → 600 000 tekens.
 *
 * OpenAI GPT-4.1 / o3 / o4-mini: 128 K context — gebruik max 95 K tokens → 380 000 tekens.
 */
export const CHUNK_MAX_CHARS_GEMINI = 3_500_000
export const CHUNK_MAX_CHARS_CLAUDE = 600_000
export const CHUNK_MAX_CHARS_OPENAI = 380_000

/** Overlap tussen opeenvolgende chunks zodat zinnen niet midden in worden geknipt. */
export const CHUNK_OVERLAP_CHARS = 2_000

/**
 * Splits een grote documenttekst in chunks van maximaal `chunkSize` tekens.
 * Probeert te knippen op document-scheidingstekens (\n\n---\n\n).
 * Kleine overlap voorkomt dat context abrupt wegvalt.
 */
export function splitDocumentChunks(text: string, chunkSize = CHUNK_MAX_CHARS): string[] {
  if (text.length <= chunkSize) return [text]

  const SEPARATOR = '\n\n---\n\n'
  const chunks: string[] = []
  let pos = 0

  while (pos < text.length) {
    const end = pos + chunkSize

    if (end >= text.length) {
      chunks.push(text.slice(pos))
      break
    }

    // Probeer te knippen op een document-separator die minstens 70% van de chunk beslaat
    const searchFrom = pos + Math.floor(chunkSize * 0.70)
    const sepIdx = text.lastIndexOf(SEPARATOR, end)

    let cutAt: number
    if (sepIdx >= searchFrom) {
      // Knip inclusief de separator zodat het volgende document een schone start heeft
      cutAt = sepIdx + SEPARATOR.length
    } else {
      // Geen goede separator gevonden — knip op woordgrens
      const spaceIdx = text.lastIndexOf(' ', end)
      cutAt = spaceIdx > pos + Math.floor(chunkSize * 0.8) ? spaceIdx : end
    }

    chunks.push(text.slice(pos, cutAt))
    // Kleine overlap: ga iets terug zodat context niet verloren gaat
    pos = Math.max(pos + 1, cutAt - CHUNK_OVERLAP_CHARS)
  }

  return chunks
}

/**
 * Maakt een kort documentmanifest: eerste ~1 500 tekens per document.
 * Wordt als context-header meegegeven aan elke chunk-call zodat de agent
 * weet welke documenten er zijn, ook als een document slechts gedeeltelijk
 * in een bepaalde chunk zit.
 */
export function extractDocumentManifest(combinedText: string): string {
  const MANIFEST_PER_DOC = 1_500
  const MAX_MANIFEST_TOTAL = 12_000
  const parts = combinedText.split('\n\n---\n\n')

  const manifestParts = parts.map((doc, i) => {
    const header = doc.slice(0, MANIFEST_PER_DOC)
    const truncated = doc.length > MANIFEST_PER_DOC
    return `[Document ${i + 1}/${parts.length}]:\n${header}${truncated ? '\n[…inhoud ingekort in manifest]' : ''}`
  })

  const full = manifestParts.join('\n\n---\n\n')
  return full.length > MAX_MANIFEST_TOTAL ? full.slice(0, MAX_MANIFEST_TOTAL) + '\n[manifest ingekort]' : full
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

/**
 * Voegt meerdere FeitenJson-resultaten samen (één per chunk).
 * Arrays worden gecombineerd; lichte redundantie is acceptabel omdat
 * stage-2 agenten ook kunnen dedupliceren.
 */
export function mergeFeitenJsonResults(results: FeitenJson[]): FeitenJson {
  return {
    feiten: results.flatMap((r) => r?.feiten ?? []),
    ontbrekende_kerninformatie: results.flatMap((r) => r?.ontbrekende_kerninformatie ?? []),
    conflicterende_feiten: results.flatMap((r) => r?.conflicterende_feiten ?? []),
  }
}

/**
 * Voegt meerdere DocumentIntakeResult-objecten samen.
 * Documenten worden gededupliceerd op naam (eerste geziene versie wint).
 */
export function mergeDocumentIntakeResults(results: DocumentIntakeResult[]): DocumentIntakeResult {
  const seenNames = new Set<string>()
  const docs: DocumentIntakeResult['document_inventarisatie'] = []

  for (const r of results) {
    for (const doc of r?.document_inventarisatie ?? []) {
      const key = doc.naam?.trim()?.toLowerCase() ?? ''
      if (key && !seenNames.has(key)) {
        seenNames.add(key)
        docs.push(doc)
      }
    }
  }

  return {
    document_inventarisatie: docs,
    ontbrekende_documenten: results.flatMap((r) => r?.ontbrekende_documenten ?? []),
    documentrisicos: results.flatMap((r) => r?.documentrisicos ?? []),
  }
}

/**
 * Voegt meerdere TenderAnalyseResult-objecten samen.
 * Neem de meest informatieve waarde per veld (eerste niet-lege/niet-onbekende).
 */
export function mergeTenderAnalyseResults(results: TenderAnalyseResult[]): TenderAnalyseResult {
  const UNKNOWN = 'niet vast te stellen op basis van de stukken'

  function bestValue(field: keyof TenderAnalyseResult['algemene_tenderanalyse']): { waarde: string; bron: string } {
    for (const r of results) {
      const v = (r?.algemene_tenderanalyse as any)?.[field]
      if (v?.waarde && !v.waarde.toLowerCase().startsWith('niet vast')) {
        return v
      }
    }
    return { waarde: UNKNOWN, bron: '' }
  }

  return {
    algemene_tenderanalyse: {
      aanbestedende_dienst: bestValue('aanbestedende_dienst'),
      type_aanbesteding: bestValue('type_aanbesteding'),
      procedure: bestValue('procedure'),
      opdrachtomschrijving: bestValue('opdrachtomschrijving'),
      contractvorm: bestValue('contractvorm'),
      gunningssystematiek: bestValue('gunningssystematiek'),
      belangrijkste_termijnen: results.flatMap((r) => r?.algemene_tenderanalyse?.belangrijkste_termijnen ?? []),
      tendercontext_risicos: results.flatMap((r) => r?.algemene_tenderanalyse?.tendercontext_risicos ?? []),
    },
  }
}
