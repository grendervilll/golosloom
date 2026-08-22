// Copy web/src to desktop/src and web/dist to desktop/app for Electron build.
const { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const base = join(__dirname, '..', '..')

// src (for development)
const webSrc = join(base, 'web', 'src')
const desktopSrc = join(__dirname, '..', 'src')
if (existsSync(webSrc)) {
  if (existsSync(desktopSrc)) rmSync(desktopSrc, { recursive: true })
  mkdirSync(desktopSrc, { recursive: true })
  cpSync(webSrc, desktopSrc, { recursive: true })
  console.log('Copied web/src -> desktop/src')
}

// dist (for production build)
const webDist = join(base, 'web', 'dist')
const desktopApp = join(__dirname, '..', 'app')
if (existsSync(webDist)) {
  if (existsSync(desktopApp)) rmSync(desktopApp, { recursive: true })
  mkdirSync(desktopApp, { recursive: true })
  cpSync(webDist, desktopApp, { recursive: true })
  // Fix index.html: replace absolute paths with relative for Electron file:// protocol
  const indexFile = join(desktopApp, 'index.html')
  if (existsSync(indexFile)) {
    let html = readFileSync(indexFile, 'utf8')
    html = html.replace(/href="\//g, 'href="./')
    html = html.replace(/src="\//g, 'src="./')
    writeFileSync(indexFile, html)
    console.log('Fixed index.html paths for Electron')
  }
  console.log('Copied web/dist -> desktop/app')
} else {
  console.error('web/dist not found — run "cd ../web && npm run build" first')
}
