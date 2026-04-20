/**
 * scripts/build-icons.cjs
 *
 * Genereert icon.png, icon.ico (Windows) en icon.icns (macOS)
 * vanuit resources/icon-source.png (minimaal 1024×1024 px).
 *
 * Gebruik: node scripts/build-icons.cjs
 * Vereist: npm install --save-dev sharp png-to-ico
 */

'use strict'

const fs   = require('fs')
const path = require('path')

const RESOURCE_DIR = path.join(__dirname, '..', 'resources')
const SOURCE       = path.join(RESOURCE_DIR, 'icon-source.png')

if (!fs.existsSync(SOURCE)) {
  console.error('❌  Bronbestand niet gevonden:', SOURCE)
  process.exit(1)
}

;(async () => {
  let sharp
  try {
    sharp = require('sharp')
  } catch {
    console.error('❌  sharp niet geïnstalleerd. Voer uit: npm install --save-dev sharp')
    process.exit(1)
  }

  // ── icon.png (256×256 — voor Linux en Electron window) ───────────────────
  const png256 = path.join(RESOURCE_DIR, 'icon.png')
  await sharp(SOURCE).resize(256, 256).png().toFile(png256)
  console.log('✓  icon.png (256×256)')

  // ── icon.ico (Windows — meerdere resoluties in één bestand) ───────────────
  let pngToIco
  try {
    pngToIco = require('png-to-ico')
    if (pngToIco.default) pngToIco = pngToIco.default
  } catch {
    console.warn('⚠   png-to-ico niet geïnstalleerd. icon.ico overgeslagen.')
    console.warn('    Installeer met: npm install --save-dev png-to-ico')
    pngToIco = null
  }

  if (pngToIco) {
    const sizes = [16, 32, 48, 64, 128, 256]
    const pngBuffers = await Promise.all(
      sizes.map(s => sharp(SOURCE).resize(s, s).png().toBuffer())
    )
    const icoBuffer = await pngToIco(pngBuffers)
    fs.writeFileSync(path.join(RESOURCE_DIR, 'icon.ico'), icoBuffer)
    console.log('✓  icon.ico (16/32/48/64/128/256 px)')
  }

  // ── icon.icns (macOS — meerdere resoluties in iconset) ────────────────────
  const { execSync } = require('child_process')
  const iconsetDir = path.join(RESOURCE_DIR, 'icon.iconset')

  if (process.platform === 'darwin') {
    fs.mkdirSync(iconsetDir, { recursive: true })

    const macSizes = [16, 32, 128, 256, 512, 1024]
    for (const s of macSizes) {
      const out1x = path.join(iconsetDir, `icon_${s}x${s}.png`)
      await sharp(SOURCE).resize(s, s).png().toFile(out1x)
      if (s <= 512) {
        const out2x = path.join(iconsetDir, `icon_${s}x${s}@2x.png`)
        await sharp(SOURCE).resize(s * 2, s * 2).png().toFile(out2x)
      }
    }

    try {
      execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(RESOURCE_DIR, 'icon.icns')}"`)
      console.log('✓  icon.icns (macOS)')
    } catch (e) {
      console.warn('⚠   iconutil mislukt:', e.message)
    }

    fs.rmSync(iconsetDir, { recursive: true, force: true })
  } else {
    // Op Windows/Linux: macOS icns bouwen met electron-icon-builder indien beschikbaar
    try {
      const iconBuilder = require('electron-icon-builder')
      await iconBuilder({
        input: SOURCE,
        output: RESOURCE_DIR,
        flatten: false,
      })
      console.log('✓  icon.icns (via electron-icon-builder)')
    } catch {
      console.warn('⚠   icon.icns overgeslagen (alleen automatisch op macOS via iconutil).')
      console.warn('    Op Windows: installeer electron-icon-builder en voer opnieuw uit.')
    }
  }

  console.log('\n✅  Icons klaar in', RESOURCE_DIR)
})()
