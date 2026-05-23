/**
 * release-commit.cjs
 *
 * Wordt aangeroepen door npm run release:patch|minor|major.
 * Leest het nieuwe versienummer uit package.json, maakt een commit aan in de
 * root-repository en pusht een versie-tag (v*.*.*).
 * GitHub Actions pikt de tag op en bouwt + publiceert de release automatisch.
 *
 * Gebruik: node scripts/release-commit.cjs [patch|minor|major]
 */
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const bump = process.argv[2] || 'patch'
const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const version = pkg.version
const tag = `v${version}`

// Werk vanuit de root van de repository (één niveau boven tender-tracker/).
const repoRoot = path.join(__dirname, '..', '..')

function run(cmd) {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd: repoRoot, stdio: 'inherit' })
}

console.log(`\n🚀  TenderTracker ${tag} (${bump}) — commit + tag + push\n`)

run('git add -A')
run(`git commit -m "chore: release ${tag}"`)
run(`git tag ${tag}`)
run('git push')
run('git push --tags')

console.log(`
✅  Tag ${tag} gepusht naar GitHub.
   GitHub Actions bouwt nu de installatiepakketten en maakt een GitHub Release aan.
   Gebruikers zien de update-melding zodra ze de app openen (na ~10 seconden).

   Voortgang bekijken:
   https://github.com/wolkjesmelker/tender-tracker/actions
`)
