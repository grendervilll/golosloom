// Определение текстовых файлов — 1:1 с web/src/utils/textFile.ts
library;

const _textExts = {
  'txt', 'md', 'markdown', 'rst', 'adoc', 'tex', 'log', 'csv', 'tsv', 'diff', 'patch',
  'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'sh', 'bash', 'zsh',
  'py', 'js', 'ts', 'jsx', 'tsx', 'dart', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'rb', 'lua', 'sql', 'html', 'css', 'scss', 'less', 'vue', 'svelte', 'xml', 'gradle', 'tf', 'hcl', 'dockerfile', 'makefile',
};

const _extLang = {
  'txt': 'plaintext', 'md': 'markdown', 'markdown': 'markdown', 'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
  'toml': 'toml', 'ini': 'ini', 'sh': 'bash', 'bash': 'bash', 'zsh': 'bash', 'py': 'python', 'js': 'javascript',
  'ts': 'typescript', 'jsx': 'javascript', 'tsx': 'typescript', 'dart': 'dart', 'go': 'go', 'rs': 'rust',
  'java': 'java', 'kt': 'kotlin', 'swift': 'swift', 'c': 'c', 'h': 'c', 'cpp': 'cpp', 'hpp': 'cpp',
  'cs': 'csharp', 'php': 'php', 'rb': 'ruby', 'lua': 'lua', 'sql': 'sql', 'html': 'xml', 'css': 'css',
  'scss': 'scss', 'less': 'less', 'vue': 'vue', 'svelte': 'svelte', 'xml': 'xml', 'gradle': 'gradle', 'tf': 'hcl',
};

bool isTextFile(String filename) {
  final parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return false;
  final ext = parts.last;
  return _textExts.contains(ext);
}

String extLang(String filename) {
  final ext = filename.toLowerCase().split('.').last;
  return _extLang[ext] ?? 'plaintext';
}
