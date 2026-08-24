// ignore_for_file: unnecessary_underscores
// Пикер смайликов и GIF — Flutter-версия web/src/components/EmojiPicker.vue
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../theme.dart';
import '../utils/emojis.dart';

class EmojiPicker extends StatefulWidget {
  final ApiClient api;
  final void Function(String emoji) onInsert;
  final void Function(String url) onSendGif;
  final VoidCallback onClose;

  const EmojiPicker({
    super.key,
    required this.api,
    required this.onInsert,
    required this.onSendGif,
    required this.onClose,
  });

  @override
  State<EmojiPicker> createState() => _EmojiPickerState();
}

class _EmojiPickerState extends State<EmojiPicker> {
  String _tab = 'emoji'; // emoji | gif
  String _query = '';
  List<Map<String, String>> _gifs = [];
  bool _gifLoading = false;
  String _gifError = '';
  String? _previewUrl;
  Timer? _pressTimer;
  Timer? _gifDebounce;
  bool _pressed = false;

  List<EmojiItem> get _emojis => searchEmojis(_query);

  void _onQuery(String v) {
    setState(() => _query = v);
    _gifDebounce?.cancel();
    _gifDebounce = Timer(const Duration(milliseconds: 300), _fetchGifs);
  }

  Future<void> _fetchGifs() async {
    final q = _query.trim();
    if (q.isEmpty) {
      setState(() => _gifs = []);
      return;
    }
    setState(() {
      _gifLoading = true;
      _gifError = '';
    });
    try {
      final res = await widget.api.gifSearch(q);
      final list = (res['gifs'] as List?) ?? const [];
      setState(() => _gifs = list
          .map((g) => {
                'url': (g['url'] as String?) ?? '',
                'preview': (g['preview'] as String?) ?? (g['url'] as String?) ?? '',
                'title': (g['title'] as String?) ?? '',
              })
          .where((m) => (m['url'] ?? '').isNotEmpty)
          .toList());
    } catch (_) {
      setState(() {
        _gifError = 'Поиск GIF недоступен на этом сервере';
        _gifs = [];
      });
    } finally {
      if (mounted) setState(() => _gifLoading = false);
    }
  }

  void _onGifDown(Map<String, String> g) {
    _pressed = true;
    _pressTimer?.cancel();
    _pressTimer = Timer(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _previewUrl = g['preview']);
    });
  }

  void _onGifUp(Map<String, String> g) {
    final wasPreview = _previewUrl != null;
    final wasPressed = _pressed;
    _pressed = false;
    _pressTimer?.cancel();
    _pressTimer = null;
    if (wasPreview) {
      setState(() => _previewUrl = null);
      return;
    }
    if (wasPressed) widget.onSendGif(g['url'] ?? '');
  }

  void _onGifLeave() {
    _pressed = false;
    _pressTimer?.cancel();
    _pressTimer = null;
    if (_previewUrl != null) setState(() => _previewUrl = null);
  }

  @override
  void dispose() {
    _pressTimer?.cancel();
    _gifDebounce?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Stack(
      children: [
        Container(
          height: 380,
          decoration: BoxDecoration(
            color: colors.bg2,
            border: Border(top: BorderSide(color: colors.border)),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
            boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.18), blurRadius: 30, offset: const Offset(0, -4))],
          ),
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(10, 10, 10, 4),
                child: TextField(
                  onChanged: _onQuery,
                  style: TextStyle(color: colors.text, fontSize: 14),
                  decoration: InputDecoration(
                    hintText: 'Поиск смайликов и GIF… (например, run)',
                    hintStyle: TextStyle(color: colors.textDim, fontSize: 13),
                    filled: true,
                    fillColor: colors.bg,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: colors.border)),
                  ),
                ),
              ),
              Expanded(
                child: _tab == 'emoji'
                    ? GridView.builder(
                        padding: const EdgeInsets.all(6),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 8,
                          childAspectRatio: 1,
                          crossAxisSpacing: 2,
                          mainAxisSpacing: 2,
                        ),
                        itemCount: _emojis.length,
                        itemBuilder: (_, i) {
                          final it = _emojis[i];
                          return InkWell(
                            onTap: () => widget.onInsert(it.e),
                            borderRadius: BorderRadius.circular(8),
                            child: Center(child: Text(it.e, style: const TextStyle(fontSize: 24))),
                          );
                        },
                      )
                    : _gifLoading
                        ? Center(child: Text('Поиск…', style: TextStyle(color: colors.textDim)))
                        : _gifError.isNotEmpty
                            ? Center(child: Text(_gifError, style: TextStyle(color: colors.textDim)))
                            : _query.trim().isEmpty
                                ? Center(child: Text('Введите запрос, например «run»', style: TextStyle(color: colors.textDim)))
                                : _gifs.isEmpty
                                    ? Center(child: Text('Ничего не найдено', style: TextStyle(color: colors.textDim)))
                                    : ListView.builder(
                                        padding: const EdgeInsets.all(6),
                                        itemCount: _gifs.length,
                                        itemBuilder: (_, i) {
                                          final g = _gifs[i];
                                          return GestureDetector(
                                            onTapDown: (_) => _onGifDown(g),
                                            onTapUp: (_) => _onGifUp(g),
                                            onTapCancel: _onGifLeave,
                                            child: Container(
                                              margin: const EdgeInsets.only(bottom: 6),
                                              clipBehavior: Clip.antiAlias,
                                              decoration: BoxDecoration(
                                                borderRadius: BorderRadius.circular(8),
                                                color: colors.bg,
                                              ),
                                              child: Image.network(
                                                g['preview'] ?? g['url'] ?? '',
                                                fit: BoxFit.cover,
                                                height: 140,
                                                width: double.infinity,
                                                errorBuilder: (_, __, ___) => Container(height: 80, color: colors.bg3, child: Icon(Icons.broken_image, color: colors.textDim)),
                                              ),
                                            ),
                                          );
                                        },
                                      ),
              ),
              Container(
                decoration: BoxDecoration(border: Border(top: BorderSide(color: colors.border))),
                child: Row(
                  children: [
                    Expanded(
                      child: TextButton(
                        style: TextButton.styleFrom(
                          backgroundColor: _tab == 'emoji' ? colors.bg3 : Colors.transparent,
                          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
                        ),
                        onPressed: () => setState(() => _tab = 'emoji'),
                        child: Text('😊 Смайлики', style: TextStyle(color: colors.text, fontWeight: FontWeight.w600)),
                      ),
                    ),
                    Expanded(
                      child: TextButton(
                        style: TextButton.styleFrom(
                          backgroundColor: _tab == 'gif' ? colors.bg3 : Colors.transparent,
                          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.zero),
                        ),
                        onPressed: () => setState(() => _tab = 'gif'),
                        child: Text('GIF', style: TextStyle(color: colors.text, fontWeight: FontWeight.w600)),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (_previewUrl != null)
          Positioned.fill(
            child: Container(
              color: Colors.black.withValues(alpha: 0.65),
              child: Center(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: Image.network(_previewUrl!, width: MediaQuery.of(context).size.width * 0.7, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Icon(Icons.broken_image, color: Colors.white, size: 48)),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
