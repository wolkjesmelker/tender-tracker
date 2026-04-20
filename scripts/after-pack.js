const fs = require('fs')
const path = require('path')

exports.default = async function(context) {
  const appDir = context.appOutDir

  // Find the app directory
  let appPath
  if (process.platform === 'darwin') {
    const macApp = fs.readdirSync(appDir).find(f => f.endsWith('.app'))
    appPath = path.join(appDir, macApp, 'Contents', 'Resources', 'app')
  } else {
    appPath = path.join(appDir, 'resources', 'app')
  }

  const targetModules = path.join(appPath, 'node_modules')
  const sourceModules = path.resolve(__dirname, '..', 'node_modules')

  // Modules that pdfmake needs but electron-builder misses
  const requiredModules = [
    'call-bind-apply-helpers',
    'math-intrinsics',
    'es-errors',
    'es-define-property',
    'es-object-atoms',
    'gopd',
    'has-symbols',
    'has-property-descriptors',
    'hasown',
    'function-bind',
    'set-function-length',
    'define-data-property',
    'has-tostringtag',
    'is-regex',
    'is-date-object',
    'object-is',
    'object-keys',
    'regexp.prototype.flags',
    'functions-have-names',
    'set-function-name',
    'define-properties',
    'call-bound',
    'is-arguments',
  ]

  let copied = 0
  for (const mod of requiredModules) {
    const targetDir = path.join(targetModules, mod)
    const sourceDir = path.join(sourceModules, mod)

    if (!fs.existsSync(targetDir) && fs.existsSync(sourceDir)) {
      fs.cpSync(sourceDir, targetDir, { recursive: true })
      copied++
    }
  }

  if (copied > 0) {
    console.log(`  • Copied ${copied} missing transitive dependencies`)
  }
}
