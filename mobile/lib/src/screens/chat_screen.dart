// Экран чата: история (пагинация), отправка, правка/удаление по долгому нажатию.
library;

import 'package:flutter/material.dart';

import '../call_service.dart';
import '../chat_store.dart';
import '../session.dart';
import 'call_picker.dart';
import 'call_screen.dart';

class ChatScreen extends StatefulWidget {
  final Session session;
  final ChatStore chat;
  final CallService calls;
  final Map<String, dynamic> channel;

  const ChatScreen({
    super.key,
    required this.session,
    required this.chat,
    required this.calls,
    required this.channel,
  });

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _input = TextEditingController();
  final _scroll = ScrollController();
  int? _editingId;
  bool _sending = false;
  String? _sendError;

  int get _channelId => (widget.channel['id'] as num?)?.toInt() ?? 0;

  @override
  void initState() {
    super.initState();
    widget.session.currentChannelId = _channelId;
    widget.session.joinChannel(_channelId);
    // Ключ мог появиться после последней проверки — пересинхронизируемся.
    widget.session.syncKeys(_channelId);
    widget.chat.loadHistory(_channelId);
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    widget.session.leaveChannel(_channelId);
    if (widget.session.currentChannelId == _channelId) {
      widget.session.currentChannelId = null;
    }
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    // У самой верхней части списка — подгружаем более старые сообщения.
    if (_scroll.position.pixels < 120) {
      widget.chat.loadOlder(_channelId);
    }
    // Недавно открыли — подвалом.
    if (_scroll.hasClients && _scroll.position.pixels > 0 && _scroll.position.maxScrollExtent - _scroll.position.pixels < 40) {
      _scroll.jumpTo(_scroll.position.maxScrollExtent);
    }
  }

  Future<void> _send() async {
    final text = _input.text.trim();
    if (text.isEmpty || _sending) return;
    if (_editingId != null) {
      await widget.chat.edit(_channelId, _editingId!, text);
      setState(() => _editingId = null);
      _input.clear();
      return;
    }
    setState(() => _sending = true);
    final ok = await widget.chat.send(_channelId, text);
    if (mounted) {
      setState(() {
        _sending = false;
        _sendError = ok ? null : 'Ключ канала ещё не получен, повторите позже';
      });
      if (ok) _input.clear();
    }
  }

  Future<void> _startCall() async {
    final targetIds = await showCallPicker(context, widget.session, _channelId);
    if (targetIds == null || targetIds.isEmpty || !mounted) return;
    final ok = await widget.calls.initiate(_channelId, targetIds);
    if (!mounted) return;
    if (ok) {
      await Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => CallScreen(session: widget.session, calls: widget.calls),
        ),
      );
    } else if (widget.calls.callError != null) {
      // Занятые/ошибки — попапом, как просили.
      final err = widget.calls.callError!;
      final isBusy = err.contains('уже с кем-то разговаривает');
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: const Color(0xFF2B2D31),
          title: Text(isBusy ? '👤 Пользователь занят' : 'Не удалось позвонить'),
          content: Text(err, style: const TextStyle(color: Color(0xFFDBDEE1))),
          actions: [
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFF5865F2)),
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Ок'),
            ),
          ],
        ),
      );
    }
  }

  void _startEdit(ChatMessage m) {
    setState(() {
      _editingId = m.id;
      _input.text = m.text ?? '';
    });
    _input.selection = TextSelection.collapsed(offset: _input.text.length);
  }

  Future<void> _onLongPress(ChatMessage m) async {
    final myId = widget.session.settings.user?.id;
    if (m.senderId != myId) return;
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: const Color(0xFF2B2D31),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit, color: Color(0xFFDBDEE1)),
              title: const Text('Изменить сообщение', style: TextStyle(color: Color(0xFFDBDEE1))),
              onTap: () => Navigator.pop(ctx, 'edit'),
            ),
            ListTile(
              leading: const Icon(Icons.delete, color: Color(0xFFDA373C)),
              title: const Text('Удалить сообщение', style: TextStyle(color: Color(0xFFDA373C))),
              onTap: () => Navigator.pop(ctx, 'delete'),
            ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (action == 'edit') {
      _startEdit(m);
    } else if (action == 'delete') {
      await widget.chat.remove(_channelId, m.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    const accent = Color(0xFF5865F2);
    const panel = Color(0xFF2B2D31);

    final messages = widget.chat.messages(_channelId);
    final channelName = (widget.channel['name'] as String?) ?? '?';

    return Scaffold(
      backgroundColor: const Color(0xFF1E1F22),
      appBar: AppBar(
        backgroundColor: panel,
        title: Text('# $channelName', style: const TextStyle(color: text, fontSize: 18)),
        actions: [
          IconButton(
            icon: const Icon(Icons.call, color: Color(0xFF23A55A)),
            tooltip: 'Позвонить участникам канала',
            onPressed: _startCall,
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView.builder(
              controller: _scroll,
              padding: const EdgeInsets.all(12),
              itemCount: messages.length,
              itemBuilder: (ctx, i) {
                final m = messages[i];
                final mine = m.senderId == widget.session.settings.user?.id;
                return _MessageItem(m: m, mine: mine, onLongPress: () => _onLongPress(m));
              },
            ),
          ),
          if (_sendError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(_sendError!, style: const TextStyle(color: Color(0xFFDA373C), fontSize: 12)),
            ),
          if (_editingId != null)
            Container(
              width: double.infinity,
              color: const Color(0xFF383A40),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: [
                  const Expanded(
                    child: Text('Редактирование сообщения', style: TextStyle(color: dim, fontSize: 13)),
                  ),
                  TextButton(
                    onPressed: () {
                      setState(() => _editingId = null);
                      _input.clear();
                    },
                    child: const Text('Отмена', style: TextStyle(color: dim)),
                  ),
                ],
              ),
            ),
          Container(
            color: panel,
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    style: const TextStyle(color: text),
                    decoration: InputDecoration(
                      hintText: _editingId != null ? 'Редактирование…' : 'Сообщение в канал…',
                      hintStyle: const TextStyle(color: dim),
                      filled: true,
                      fillColor: const Color(0xFF1E1F22),
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                    ),
                    onSubmitted: (_) => _send(),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  icon: const Icon(Icons.send, color: Colors.white),
                  style: IconButton.styleFrom(backgroundColor: accent, disabledBackgroundColor: accent.withValues(alpha: 0.5)),
                  onPressed: _input.text.trim().isEmpty ? null : _send,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MessageItem extends StatelessWidget {
  final ChatMessage m;
  final bool mine;
  final VoidCallback onLongPress;

  const _MessageItem({required this.m, required this.mine, required this.onLongPress});

  @override
  Widget build(BuildContext context) {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);

    final time = '${m.createdAt.hour.toString().padLeft(2, '0')}:${m.createdAt.minute.toString().padLeft(2, '0')}';

    String body;
    var bodyStyle = const TextStyle(color: text, fontSize: 15);
    if (m.pending) {
      body = m.text ?? '';
      bodyStyle = const TextStyle(color: dim, fontStyle: FontStyle.italic, fontSize: 15);
    } else if (m.deleted) {
      body = 'Сообщение удалено';
      bodyStyle = const TextStyle(color: dim, fontStyle: FontStyle.italic, fontSize: 15);
    } else if (m.encrypted) {
      body = '🔒 Сообщение зашифровано (ключ канала недоступен)';
      bodyStyle = const TextStyle(color: dim, fontStyle: FontStyle.italic, fontSize: 15);
    } else {
      body = m.text ?? '';
    }

    return InkWell(
      onLongPress: mine ? onLongPress : null,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Flexible(
                  child: Text(
                    m.senderNick,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: mine ? const Color(0xFF5865F2) : const Color(0xFF23A55A),
                      fontWeight: FontWeight.w700,
                      fontSize: 14,
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                Text(time, style: const TextStyle(color: dim, fontSize: 11)),
                if (m.edited) const Padding(
                  padding: EdgeInsets.only(left: 6),
                  child: Text('(изменено)', style: TextStyle(color: dim, fontSize: 11)),
                ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.only(top: 1),
              child: Text(body, style: bodyStyle),
            ),
          ],
        ),
      ),
    );
  }
}
