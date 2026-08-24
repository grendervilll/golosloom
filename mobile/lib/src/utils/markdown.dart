// Лёгкий markdown-рендер — 1:1 с web/src/utils/markdown.ts
library;

class MarkdownSegment {
  final String type; // 'text' | 'code'
  final String? html; // для text — отрендеренный inline HTML уже экранированный
  final String? lang;
  final String? code;
  const MarkdownSegment({required this.type, this.html, this.lang, this.code});
}

String escapeHtml(String s) => s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

final _codeRe = RegExp(r'```([\w+.#-]*)\n?([\s\S]*?)```');
const _sentinel = '\u0000CODE\u0000';

List<MarkdownSegment> splitMarkdown(String text) {
  final out = <MarkdownSegment>[];
  var last = 0;
  for (final m in _codeRe.allMatches(text)) {
    if (m.start > last) {
      out.add(MarkdownSegment(type: 'text', html: renderInline(text.substring(last, m.start))));
    }
    final lang = m.group(1) ?? '';
    final code = (m.group(2) ?? '').replaceFirst(RegExp(r'\n$'), '');
    out.add(MarkdownSegment(type: 'code', lang: lang, code: code));
    last = m.end;
  }
  if (last < text.length) {
    out.add(MarkdownSegment(type: 'text', html: renderInline(text.substring(last))));
  }
  if (out.isEmpty) out.add(const MarkdownSegment(type: 'text', html: ''));
  return out;
}

String renderInline(String src) {
  final esc = escapeHtml(src);
  final codeSpans = <String>[];
  var withoutCode = esc.replaceAllMapped(RegExp(r'`([^`\n]+)`'), (m) {
    codeSpans.add(m.group(1)!);
    return '$_sentinel${codeSpans.length - 1}$_sentinel';
  });
  var html = withoutCode
      .replaceAllMapped(RegExp(r'\*\*([^*\n]+)\*\*'), (m) => '<strong>${m.group(1)}</strong>')
      .replaceAllMapped(RegExp(r'(^|[\s\(])\*([^*\n]+)\*'), (m) => '${m.group(1)}<em>${m.group(2)}</em>')
      .replaceAllMapped(RegExp(r'~~([^~\n]+)~~'), (m) => '<s>${m.group(1)}</s>')
      .replaceAllMapped(RegExp(r'\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)'), (m) => '<a href="${m.group(2)}">${m.group(1)}</a>')
      .replaceAll('\n', '<br>');
  html = html.replaceAllMapped(RegExp('$_sentinel(\\d+)$_sentinel'), (m) => '<code>${codeSpans[int.parse(m.group(1)!)]}</code>');
  return html;
}
