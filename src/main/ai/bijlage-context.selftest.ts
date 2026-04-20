/**
 * Snelle checks op bijlage-promptcap en naamextractie. Run: npm run test:bijlage
 */
import assert from 'node:assert/strict'
import {
  buildTenderBijlageContext,
  extractBijlageNamenFromDocumentTexts,
  normalizeBijlageNameKey,
} from './bijlage-context'

const tender = { titel: 'Test', beschrijving: '' }

// Cap: derde bijlage valt buiten de prompt
const docs = [
  '\n--- BIJLAGE: Eerste ---\n' + 'a'.repeat(80_000),
  '\n--- BIJLAGE: Tweede ---\n' + 'b'.repeat(80_000),
  '\n--- BIJLAGE: Derde ---\n' + 'c'.repeat(200_000),
]
const cap = 120_000
const ctx = buildTenderBijlageContext(tender, '', docs, cap)
assert.equal(ctx.includedDocIndices.length, 2, 'twee docs volledig in prompt vóór cap')
assert.ok(ctx.stats.omittedFromPromptCount >= 1)
const inPrompt = ctx.includedDocIndices.map((i) => docs[i])
const namesInPrompt = extractBijlageNamenFromDocumentTexts(inPrompt)
const allNames = extractBijlageNamenFromDocumentTexts(docs)
assert.deepEqual(namesInPrompt, ['Eerste', 'Tweede'])
assert.deepEqual(allNames, ['Eerste', 'Tweede', 'Derde'])

// Normalisatie: zelfde sleutel
assert.equal(normalizeBijlageNameKey('  Foo  bar '), normalizeBijlageNameKey('Foo bar'))

console.log('bijlage-context.selftest: OK')
