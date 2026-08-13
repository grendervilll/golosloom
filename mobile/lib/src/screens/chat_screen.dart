// Экран чата (по макету active-chat): шапка с аватаром и статусом,
// пузыри сообщений, поле ввода-капсула с кнопкой отправки.
library;

import 'package:flutter/material.dart';

import '../call_service.dart';
import '../chat_store.dart';
import '../session.dart';
import '../theme.dart';
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
    widget.chat.addListener(_onChatChanged);
    widget.chat.loadHistory(_channelId);
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    widget.chat.removeListener(_onChatChanged);
    widget.session.leaveChannel(_channelId);
    if (widget.session.currentChannelId == _channelId) {
      widget.session.currentChannelId = null;
    }
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onChatChanged() {
    if (!mounted) return;
    setState(() {});
    // Автопрокрутка вниз, если мы и так у нижнего края.
    final pos = _scroll.position;
    if (pos.hasContentDimensions &&
        pos.maxScrollExtent - pos.pixels < 80) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scroll.hasClients) {
          _scroll.animateTo(
            _scroll.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });
    }
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
          builder: (_) => CallScreen(session: widget.session, calls: widget.calls, chat: widget.chat),
        ),
      );
    } else if (widget.calls.callError != null) {
      // Занятые/ошибки — попапом, как просили.
      final err = widget.calls.callError!;
      final isBusy = err.contains('уже с кем-то разговаривает');
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: Text(isBusy ? '👤 Пользователь занят' : 'Не удалось позвонить'),
          content: Text(err),
          actions: [
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.of(ctx).accent),
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Ок'),
            ),
          ],
        ),
      );
    }
  }

  /// Инфо о канале (по макету contact-profile): аватар, имя, ID, звонок.
  Future<void> _showInfo() async {
    final colors = AppColors.of(context);
    final name = (widget.channel['name'] as String?) ?? '?';
    final created = widget.channel['created_at'] as String?;
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(24, 24, 24, 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _LetterAvatar(name: name, size: 100),
              const SizedBox(height: 16),
              Text(name, textAlign: TextAlign.center,
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w700)),
              const SizedBox(height: 4),
              Text('Канал · ID: $_channelId', style: TextStyle(color: colors.textDim, fontSize: 14)),
              if (created != null)
                Text(
                  'Создан: ${DateTime.tryParse(created)?.toLocal().toString().substring(0, 10) ?? ''}',
                  style: TextStyle(color: colors.textDim, fontSize: 13),
                ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  _QuickAction(icon: Icons.call, label: 'Звонок', onTap: () {
                    Navigator.pop(ctx);
                    _startCall();
                  }),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _startEdit(ChatMessage m) {
    setState(() {
      _editingId = m.id;
      _input.text = m.text ?? '';
    });
    _input.selection = TextSelection.collapsed(offset: _input.text.length);
  }

  Future<void> _onLongPress(ChatMessage m) async {
    final colors = AppColors.of(context);
    final myId = widget.session.settings.user?.id;
    if (m.senderId != myId) return;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.edit),
              title: const Text('Изменить сообщение'),
              onTap: () => Navigator.pop(ctx, 'edit'),
            ),
            ListTile(
              leading: Icon(Icons.delete, color: colors.danger),
              title: Text('Удалить сообщение', style: TextStyle(color: colors.danger)),
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
    final colors = AppColors.of(context);
    final messages = widget.chat.messages(_channelId);
    final channelName = (widget.channel['name'] as String?) ?? '?';

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: colors.text),
          onPressed: () => Navigator.of(context).pop(),
        ),
        titleSpacing: 0,
        title: InkWell(
          onTap: _showInfo,
          borderRadius: BorderRadius.circular(10),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
            child: Row(
              children: [
                _LetterAvatar(name: channelName, size: 36),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(channelName,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                      Text('ID: $_channelId',
                          style: TextStyle(color: colors.online, fontSize: 12)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          IconButton(
            icon: Icon(Icons.call, color: colors.online),
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
                return _MessageBubble(m: m, mine: mine, onLongPress: () => _onLongPress(m));
              },
            ),
          ),
          if (_sendError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(_sendError!, style: TextStyle(color: colors.danger, fontSize: 12)),
            ),
          if (_editingId != null)
            Container(
              width: double.infinity,
              color: colors.surface,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: [
                  Expanded(
                    child: Text('Редактирование сообщения', style: TextStyle(color: colors.textDim, fontSize: 13)),
                  ),
                  TextButton(
                    onPressed: () {
                      setState(() => _editingId = null);
                      _input.clear();
                    },
                    child: Text('Отмена', style: TextStyle(color: colors.textDim)),
                  ),
                ],
              ),
            ),
          Container(
            color: colors.surface,
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    style: TextStyle(color: colors.text, fontSize: 15),
                    decoration: InputDecoration(
                      hintText: _editingId != null ? 'Редактирование…' : 'Сообщение…',
                      hintStyle: TextStyle(color: colors.textDim),
                      fillColor: colors.bubbleIn,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                    ),
                    onSubmitted: (_) => _send(),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
                const SizedBox(width: 8),
                // Круглая кнопка отправки (как в макете).
                SizedBox(
                  width: 44,
                  height: 44,
                  child: IconButton(
                    padding: EdgeInsets.zero,
                    icon: const Icon(Icons.send, color: Colors.white, size: 20),
                    style: IconButton.styleFrom(
                      backgroundColor: colors.accent,
                      disabledBackgroundColor: colors.accent.withValues(alpha: 0.4),
                    ),
                    onPressed: _input.text.trim().isEmpty ? null : _send,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Пузырь сообщения: свои — синие справа, чужие — серые слева.
class _MessageBubble extends StatelessWidget {
  final ChatMessage m;
  final bool mine;
  final VoidCallback onLongPress;

  const _MessageBubble({required this.m, required this.mine, required this.onLongPress});

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final time = '${m.createdAt.hour.toString().padLeft(2, '0')}:${m.createdAt.minute.toString().padLeft(2, '0')}';

    String body;
    var bodyStyle = TextStyle(color: mine ? Colors.white : colors.text, fontSize: 15, height: 1.35);
    if (m.pending) {
      body = m.text ?? '';
      bodyStyle = TextStyle(color: colors.textDim, fontStyle: FontStyle.italic, fontSize: 15);
    } else if (m.deleted) {
      body = 'Сообщение удалено';
      bodyStyle = TextStyle(color: colors.textDim, fontStyle: FontStyle.italic, fontSize: 15);
    } else if (m.encrypted) {
      body = '🔒 Сообщение зашифровано (ключ канала недоступен)';
      bodyStyle = TextStyle(color: colors.textDim, fontStyle: FontStyle.italic, fontSize: 15);
    } else {
      body = m.text ?? '';
    }

    final bubble = Container(
      constraints: const BoxConstraints(maxWidth: 300),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: mine ? colors.bubbleOut : colors.bubbleIn,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(mine ? 16 : 4),
          topRight: Radius.circular(mine ? 4 : 16),
          bottomLeft: const Radius.circular(16),
          bottomRight: const Radius.circular(16),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!mine)
            Text(
              m.senderNick,
              style: TextStyle(
                color: colors.accent,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          Text(body, style: bodyStyle),
          const SizedBox(height: 3),
          Align(
            alignment: Alignment.centerRight,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  time,
                  style: TextStyle(
                    color: mine ? Colors.white.withValues(alpha: 0.8) : colors.textDim,
                    fontSize: 10,
                  ),
                ),
                if (mine)
                  Padding(
                    padding: const EdgeInsets.only(left: 3),
                    child: Icon(
                      m.pending ? Icons.schedule : Icons.done_all,
                      color: Colors.white.withValues(alpha: 0.8),
                      size: 13,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: mine ? MainAxisAlignment.end : MainAxisAlignment.start,
        children: [
          InkWell(
            onLongPress: mine ? onLongPress : null,
            borderRadius: BorderRadius.circular(16),
            child: bubble,
          ),
        ],
      ),
    );
  }
}

class _LetterAvatar extends StatelessWidget {
  final String name;
  final double size;

  const _LetterAvatar({required this.name, required this.size});

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final letter = name.isEmpty ? '?' : name[0].toUpperCase();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: colors.accent, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: TextStyle(color: Colors.white, fontSize: size * 0.5, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _QuickAction({required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(16),
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: colors.accent.withValues(alpha: 0.08),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: colors.accent, size: 22),
            ),
            const SizedBox(height: 8),
            Text(label, style: TextStyle(color: colors.accent, fontSize: 12, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}
