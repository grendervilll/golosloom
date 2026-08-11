// Выбор участников для звонка (из участников канала).
library;

import 'package:flutter/material.dart';

import '../session.dart';

Future<List<int>?> showCallPicker(BuildContext context, Session session, int channelId) {
  return showModalBottomSheet<List<int>>(
    context: context,
    backgroundColor: const Color(0xFF2B2D31),
    builder: (ctx) => _CallPicker(session: session, channelId: channelId),
  );
}

class _CallPicker extends StatefulWidget {
  final Session session;
  final int channelId;

  const _CallPicker({required this.session, required this.channelId});

  @override
  State<_CallPicker> createState() => _CallPickerState();
}

class _CallPickerState extends State<_CallPicker> {
  final Set<int> _selected = {};
  List<dynamic> _members = [];
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final members = await widget.session.api.members(widget.channelId);
      if (mounted) setState(() => _members = members);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  void _toggle(int userId) {
    setState(() {
      if (_selected.contains(userId)) {
        _selected.remove(userId);
      } else {
        _selected.add(userId);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    const accent = Color(0xFF5865F2);
    final myId = widget.session.settings.user?.id;
    final candidates = _members.where((m) => (m['user_id'] as num?)?.toInt() != myId).toList();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text('Кому позвонить?', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                TextButton(
                  onPressed: () => setState(() => _selected.addAll(candidates.map((m) => (m['user_id'] as num).toInt()))),
                  child: const Text('Выбрать всех', style: TextStyle(color: dim)),
                ),
                TextButton(
                  onPressed: () => setState(() => _selected.clear()),
                  child: const Text('Снять всех', style: TextStyle(color: dim)),
                ),
              ],
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(_error!, style: const TextStyle(color: Color(0xFFDA373C), fontSize: 13)),
              ),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final m in candidates)
                    CheckboxListTile(
                      value: _selected.contains((m['user_id'] as num?)?.toInt()),
                      onChanged: (_) => _toggle((m['user_id'] as num).toInt()),
                      title: Text((m['nick'] as String?) ?? '?', style: const TextStyle(color: text)),
                      subtitle: Text('ID: ${m['user_id']}',
                          style: const TextStyle(color: dim, fontSize: 12)),
                      activeColor: accent,
                    ),
                  if (candidates.isEmpty)
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(child: Text('В канале нет других участников', style: TextStyle(color: dim))),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: accent, minimumSize: const Size.fromHeight(48)),
              onPressed: _selected.isEmpty
                  ? null
                  : () => Navigator.of(context).pop(_selected.toList()),
              child: const Text('Позвонить'),
            ),
          ],
        ),
      ),
    );
  }
}
