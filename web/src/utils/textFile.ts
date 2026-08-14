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

// Язык подсветки (highlight.js) по расширению файла. Автоопределение по
// содержимому ненадёжно (на коротких фрагментах highlight.js ошибается),
// а имя файла даёт точный ответ.
const EXT_LANG: Record<string, string> = {
  go: 'go', py: 'python', js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  vue: 'vue', rs: 'rust', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp',
  cc: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', swift: 'swift', dart: 'dart', lua: 'lua',
  pl: 'perl', r: 'r', m: 'objectivec', sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  bat: 'bat', cmd: 'batch', sql: 'sql', html: 'xml', htm: 'xml', xml: 'xml', css: 'css',
  scss: 'scss', less: 'less', json: 'json', yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini',
  md: 'markdown', markdown: 'markdown', diff: 'diff', gradle: 'gradle', tf: 'hcl',
  proto: 'protobuf', erl: 'erlang', ex: 'elixir', exs: 'elixir', hs: 'haskell', clj: 'clojure',
  scala: 'scala', groovy: 'groovy', vb: 'vbnet', pas: 'delphi', asm: 'nasm', fs: 'fsharp',
  fsx: 'fsharp', tex: 'tex', csv: 'plaintext', log: 'plaintext', txt: 'plaintext',
}

export function langByFilename(filename: string): string | null {
  const name = filename.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  if (name === 'makefile') return 'makefile'
  const ext = name.split('.').pop() || ''
  return EXT_LANG[ext] || null
}
