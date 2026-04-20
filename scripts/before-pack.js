const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// This script runs before electron-builder packs the app.
// It installs production dependencies with nested strategy to ensure
// all transitive dependencies are present.
exports.default = async function(context) {
  const appDir = context.appOutDir
    ? path.join(context.appOutDir, 'resources', 'app')
    : context.electronPlatformName
      ? path.resolve('.')
      : path.resolve('.')

  // The app output directory where files are staged
  const outDir = context.appOutDir
  if (!outDir) return

  const appPath = path.join(outDir, '..', '..', '..')

  // Copy node_modules from local project to the build output
  const srcModules = path.resolve(__dirname, '..', 'node_modules')
  const pkgJson = path.resolve(__dirname, '..', 'package.json')

  // Create a temp dir, install production deps there, then copy
  const tmpDir = path.join(path.resolve(__dirname, '..'), '.prod-deps')

  // Clean up any previous
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true })
  }
  fs.mkdirSync(tmpDir, { recursive: true })

  // Copy package.json
  fs.copyFileSync(pkgJson, path.join(tmpDir, 'package.json'))

  // Install production deps only
  console.log('  • Installing production dependencies...')
  execSync('npm install --omit=dev --install-strategy=nested', {
    cwd: tmpDir,
    stdio: 'pipe',
    env: { ...process.env, npm_config_optional: 'false' }
  })

  // Now copy these clean node_modules to the app output
  // Find the actual app directory in the build output
  let targetAppDir
  if (process.platform === 'darwin') {
    const macApp = fs.readdirSync(outDir).find(f => f.endsWith('.app'))
    if (macApp) {
      targetAppDir = path.join(outDir, macApp, 'Contents', 'Resources', 'app')
    }
  }
  if (!targetAppDir) {
    targetAppDir = path.join(outDir, 'resources', 'app')
  }

  if (fs.existsSync(targetAppDir)) {
    const targetModules = path.join(targetAppDir, 'node_modules')
    // Remove any existing node_modules in the target
    if (fs.existsSync(targetModules)) {
      fs.rmSync(targetModules, { recursive: true })
    }
    // Copy the clean production node_modules
    console.log(`  • Copying production node_modules to ${targetModules}`)
    fs.cpSync(path.join(tmpDir, 'node_modules'), targetModules, { recursive: true })

    // Rebuild native modules for electron
    console.log('  • Rebuilding native modules for Electron...')
    try {
      execSync('npx @electron/rebuild --module-dir ' + JSON.stringify(targetModules), {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'pipe'
      })
    } catch (e) {
      // Try alternative rebuild
      try {
        execSync('npx electron-rebuild -m ' + JSON.stringify(targetAppDir), {
          cwd: path.resolve(__dirname, '..'),
          stdio: 'pipe'
        })
      } catch (e2) {
        console.log('  • Warning: native module rebuild failed, copying pre-built modules')
        // Copy better-sqlite3 native binary from local build
        const localBinding = path.join(srcModules, 'better-sqlite3', 'build')
        const targetBinding = path.join(targetModules, 'better-sqlite3', 'build')
        if (fs.existsSync(localBinding)) {
          fs.cpSync(localBinding, targetBinding, { recursive: true })
        }
      }
    }
  }

  // Clean up temp dir
  fs.rmSync(tmpDir, { recursive: true })
  console.log('  • Production dependencies installed successfully')
}
