import { DEFAULT_DOCUMENT_FILL_PROMPT_TEXT } from '../../shared/document-fill-prompt-default'

/**
 * Systeem-prompt voor de document-invul-pre-analyse.
 *
 * De tekst staat in een shared module (`src/shared/document-fill-prompt-default.ts`)
 * zodat zowel main-process (engine) als renderer (Instellingen → Prompts)
 * dezelfde default tonen. Gebruikers kunnen deze prompt aanpassen in
 * Instellingen → Prompts; `app_settings.document_fill_prompt` overschrijft
 * deze default op runtime.
 *
 * Harde regels (ook in code afgedwongen via substring-validatie):
 * - Geen verzinsels: alleen expliciet gevraagde informatie uit de
 *   documenttekst mag worden opgenomen.
 * - Alle teruggegeven quotes zijn LETTERLIJKE substrings van de
 *   aangeleverde documenttekst; main process verwerpt items waarvan de
 *   quote niet exact (of na whitespace-collapse) voorkomt.
 * - Output is geldige JSON volgens het meegegeven schema.
 */
export const DEFAULT_DOCUMENT_FILL_PROMPT = DEFAULT_DOCUMENT_FILL_PROMPT_TEXT

/**
 * JSON-schema-hint die bij taak A (invulvelden) wordt meegestuurd als
 * onderdeel van het user-message, zodat de default-prompt generiek blijft
 * en alleen de verwachte output-vorm per aanroep wordt vastgezet.
 */
export const FIELD_EXTRACTION_JSON_SCHEMA_HINT = `Retourneer UITSLUITEND geldige JSON in dit schema:
{
  "document_type_hint": string,
  "fields": [
    {
      "id": string,
      "label": string,
      "type": "text"|"textarea"|"date"|"amount"|"number"|"choice"|"multichoice"|"boolean",
      "required": boolean,
      "description": string|null,
      "options": [{"value": string, "label": string}]|null,
      "group": string|null,
      "order": number,
      "source_quote": string
    }
  ]
}
Elk veld MOET een "source_quote" bevatten: een LETTERLIJKE substring uit
de aangeleverde documenttekst die onderbouwt dat dit veld gevraagd wordt.
Items zonder geldige substring worden verworpen.`

/** JSON-schema-hint voor taak B (checklist). */
export const CHECKLIST_EXTRACTION_JSON_SCHEMA_HINT = `Retourneer UITSLUITEND geldige JSON in dit schema:
{
  "items": [
    {
      "id": string,
      "label": string,
      "hint": string|null,
      "order": number,
      "source_quote": string
    }
  ]
}
Elk item MOET een "source_quote" bevatten: een LETTERLIJKE substring uit
de aangeleverde documenttekst die onderbouwt dat dit stuk / deze
informatie door de inschrijver moet worden aangeleverd. Items zonder
geldige substring worden verworpen. Label: kort en concreet (max ~90
tekens). Hint: optionele verduidelijking in één zin.`
