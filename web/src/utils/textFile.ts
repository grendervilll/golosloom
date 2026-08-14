// Определение текстовых файлов: mime text/* + исходники языков
// программирования и конфиги по расширению (их mime может быть
// application/octet-stream).
const TEXT_EXTS = new Set([
  // Исходники
  'py', 'js', 'jsx', 'ts', 'tsx', 'vue', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp',
  'cs', 'php', 'rb', 'swift', 'dart', 'lua', 'pl', 'r', 'm', 'mm', 'sh', 'bash', 'zsh',
  'ps1', 'bat', 'cmd', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'xml', 'json', 'yml',
  'yaml', 'toml', 'ini', 'conf', 'cfg', 'env', 'properties', 'gradle', 'tf', 'proto',
  'dockerfile', 'makefile', 'cmake', 'nim', 'ex', 'exs', 'erl', 'hs', 'clj', 'scala',
  'groovy', 'vb', 'pas', 'asm', 's', 'fs', 'fsx', 'ml', 'v', 'zig', 'odin', 'cr', 'go2',
  // Тексты и разметка
  'txt', 'md', 'markdown', 'rst', 'adoc', 'tex', 'log', 'csv', 'tsv', 'diff', 'patch',
  'svg', 'graphql', 'prisma',
])

export function isTextFile(mime: string, filename: string): boolean {
  if (mime.startsWith('text/')) return true
  const name = filename.toLowerCase()
  const ext = name.split('.').pop() || ''
  return TEXT_EXTS.has(ext) || name === 'dockerfile' || name === 'makefile'
}
