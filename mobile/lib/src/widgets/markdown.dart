// ignore_for_file: unnecessary_underscores
// Рендер markdown — Flutter-версия web/src/utils/markdown.ts
// Поддержка: ```lang code```, `inline`, **жирный**, *курсив*, ~~зачёрк~~, [ссылка](https://…)
library;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../theme.dart';
import '../utils/markdown.dart';

class MarkdownView extends StatelessWidget {
  final String text;
  final bool mine;
  const MarkdownView({super.key, required this.text, this.mine = false});

  @override
  Widget build(BuildContext context) {
    // GIF — отдельный рендер как в web MessageItem.vue
    final gifMatch = RegExp(r'!\[gif\]\((https?:\/\/[^)\s]+)\)').firstMatch(text.trim());
    if (gifMatch != null) {
      final url = gifMatch.group(1)!;
      return ClipRRect(
        borderRadius: BorderRadius.circular(8),
        child: Image.network(
          url,
          width: 220,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Text(text, style: TextStyle(color: mine ? Colors.white : AppColors.of(context).text, fontSize: 14)),
        ),
      );
    }

    final segs = splitMarkdown(text);
    if (segs.length == 1 && segs.first.type == 'text') {
      return _InlineText(html: segs.first.html ?? '', mine: mine);
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (final s in segs)
          if (s.type == 'code')
            _CodeBlock(code: s.code ?? '', lang: s.lang ?? '', mine: mine)
          else
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: _InlineText(html: s.html ?? '', mine: mine),
            ),
      ],
    );
  }
}

class _InlineText extends StatelessWidget {
  final String html;
  final bool mine;
  const _InlineText({required this.html, required this.mine});

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final spans = _parseHtml(html, mine, colors);
    return RichText(
      text: TextSpan(children: spans, style: TextStyle(color: mine ? Colors.white : colors.text, fontSize: 14, height: 1.35)),
    );
  }

  List<InlineSpan> _parseHtml(String html, bool mine, AppColors colors) {
    // html уже экранирован и содержит <strong>, <em>, <s>, <a href="...">, <code>, <br>
    final spans = <InlineSpan>[];
    // Разбиваем по тегам
    final re = RegExp(r'(<br\s*\/?>)|(<strong>(.*?)<\/strong>)|(<em>(.*?)<\/em>)|(<s>(.*?)<\/s>)|(<code>(.*?)<\/code>)|(<a\s+href="([^"]+)"[^>]*>(.*?)<\/a>)');
    var last = 0;
    for (final m in re.allMatches(html)) {
      if (m.start > last) {
        final txt = _unescape(html.substring(last, m.start));
        if (txt.isNotEmpty) spans.add(TextSpan(text: txt));
      }
      if (m.group(1) != null) {
        spans.add(const TextSpan(text: '\n'));
      } else if (m.group(2) != null) {
        spans.add(TextSpan(text: _unescape(m.group(3) ?? ''), style: const TextStyle(fontWeight: FontWeight.w700)));
      } else if (m.group(4) != null) {
        spans.add(TextSpan(text: _unescape(m.group(5) ?? ''), style: const TextStyle(fontStyle: FontStyle.italic)));
      } else if (m.group(6) != null) {
        spans.add(TextSpan(text: _unescape(m.group(7) ?? ''), style: const TextStyle(decoration: TextDecoration.lineThrough)));
      } else if (m.group(8) != null) {
        final code = _unescape(m.group(9) ?? '');
        spans.add(WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            decoration: BoxDecoration(color: mine ? Colors.white.withValues(alpha: 0.2) : colors.bg3, borderRadius: BorderRadius.circular(4)),
            child: Text(code, style: TextStyle(fontFamily: 'monospace', fontSize: 13, color: mine ? Colors.white : colors.text)),
          ),
        ));
      } else if (m.group(10) != null) {
        final href = m.group(11) ?? '';
        final label = _unescape(m.group(12) ?? href);
        spans.add(TextSpan(
          text: label,
          style: TextStyle(color: mine ? Colors.white : colors.accent, decoration: TextDecoration.underline),
          recognizer: TapGestureRecognizer()
            ..onTap = () async {
              final uri = Uri.tryParse(href);
              if (uri != null) await launchUrl(uri, mode: LaunchMode.externalApplication);
            },
        ));
      }
      last = m.end;
    }
    if (last < html.length) {
      final txt = _unescape(html.substring(last));
      if (txt.isNotEmpty) spans.add(TextSpan(text: txt));
    }
    if (spans.isEmpty) spans.add(const TextSpan(text: ''));
    return spans;
  }

  String _unescape(String s) => s
      .replaceAll('&amp;', '&')
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('<br>', '\n');
}

class _CodeBlock extends StatelessWidget {
  final String code;
  final String lang;
  final bool mine;
  const _CodeBlock({required this.code, required this.lang, required this.mine});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: const Color(0xFF161B22),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (lang.isNotEmpty)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.05),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
              ),
              child: Row(
                children: [
                  Text(lang, style: const TextStyle(color: Color(0xFF8B949E), fontSize: 11, fontWeight: FontWeight.w600)),
                  const Spacer(),
                  GestureDetector(
                    onTap: () {},
                    child: const Icon(Icons.copy, color: Color(0xFF8B949E), size: 14),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.all(10),
            child: SelectableText(
              code,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, height: 1.5, color: Color(0xFFE6EDF3)),
            ),
          ),
        ],
      ),
    );
  }
}
