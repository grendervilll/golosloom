// Copy web/src to desktop/src for Electron build.
// The frontend code is shared between web and desktop.
const { cpSync, existsSync, mkdirSync, rmSync } = require('fs')
const { join, dirname } = require('path')

const webSrc = join(__dirname, '..', '..', 'web', 'src')
const desktopSrc = join(__dirname, '..', 'src')

if (!existsSync(webSrc)) {
  console.error('web/src not found — run from desktop/')
  process.exit(1)
}

// Remove old copy and recreate
if (existsSync(desktopSrc)) rmSync(desktopSrc, { recursive: true })
mkdirSync(desktopSrc, { recursive: true })
cpSync(webSrc, desktopSrc, { recursive: true })
console.log('Copied web/src -> desktop/src')
