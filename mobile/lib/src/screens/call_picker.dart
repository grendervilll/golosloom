// Выбор участников для звонка (из участников канала) — как web CallModal/InviteToCallModal.
library;

import 'package:flutter/material.dart';

import '../session.dart';
import '../theme.dart';

Future<List<int>?> showCallPicker(BuildContext context, Session session, int channelId, {Set<int>? excludeIds}) {
  return showModalBottomSheet<List<int>>(
    context: context,
    backgroundColor: AppColors.of(context).bg2,
    builder: (ctx) => _CallPicker(session: session, channelId: channelId, excludeIds: excludeIds),
  );
}

class _CallPicker extends StatefulWidget {
  final Session session;
  final int channelId;
  final Set<int>? excludeIds;

  const _CallPicker({required this.session, required this.channelId, this.excludeIds});

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

  String _roleIcon(Map m) {
    if (m['is_server_admin'] == true) return '👑';
    final r = (m['role'] as String?) ?? 'user';
    if (r == 'channel_admin') return '🛡️';
    if (r == 'channel_moderator') return '⚔️';
    return '👤';
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final text = colors.text;
    final dim = colors.textDim;
    final accent = colors.accent;
    final myId = widget.session.settings.user?.id;
    final exclude = widget.excludeIds ?? const <int>{};
    final candidates = _members.where((m) {
      final id = (m['user_id'] as num?)?.toInt() ?? 0;
      return id != myId && !exclude.contains(id);
    }).toList();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Кому позвонить?', style: TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                TextButton(
                  onPressed: () => setState(() => _selected.addAll(candidates.map((m) => (m['user_id'] as num).toInt()))),
                  child: Text('Выбрать всех', style: TextStyle(color: dim)),
                ),
                TextButton(
                  onPressed: () => setState(() => _selected.clear()),
                  child: Text('Снять всех', style: TextStyle(color: dim)),
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
                      title: Text('${_roleIcon(m)} ${(m['nick'] as String?) ?? '?'}', style: TextStyle(color: text)),
                      subtitle: Text('ID: ${m['user_id']}',
                          style: TextStyle(color: dim, fontSize: 12)),
                      activeColor: accent,
                    ),
                  if (candidates.isEmpty)
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Center(child: Text(
                          exclude.isNotEmpty ? 'Нет доступных пользователей' : 'В канале нет других участников',
                          style: TextStyle(color: dim))),
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
