/**
 * Bepaalt of een bron-URL (formulier / vragenlijst) in de app moet worden getoond
 * i.p.v. een nieuw browservenster of extern programma.
 */

export function isLikelyVragenlijstDocumentNaam(naam: string): boolean {
  const n = naam.toLowerCase()
  return (
    /vragenlijst|questionnaire|questionnair/i.test(n) ||
    /\buea\b|uniform europees aanbestedingsdocument/i.test(n) ||
    /\b(formulier|inschrijfformulier|deelnemersformulier)\b/i.test(n)
  )
}

/** Webpagina (SPA) in webview; directe PDF/Office-URL blijft bij preview of extern openen. */
export function shouldLoadBronUrlInEmbeddedBrowser(fileName: string, url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return false
  if (!isLikelyVragenlijstDocumentNaam(fileName)) return false
  const pathOnly = url.split('?')[0].split('#')[0].toLowerCase()
  if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z)$/i.test(pathOnly)) return false
  return true
}

export function isFormulierBronNavLink(link: { titel?: string; categorie?: string; url: string }): boolean {
  const t = `${link.titel || ''} ${link.categorie || ''} ${link.url}`.toLowerCase()
  return (
    /\b(vragenlijst|formulier|questionnaire|inschrijf|uea|europese inschrijf)\b/i.test(t) ||
    /\/forms?\//i.test(link.url)
  )
}
