// Экран чата (по макету active-chat): шапка с аватаром и статусом,
// пузыри сообщений, поле ввода-капсула с кнопкой отправки.
// Длинное нажатие на кнопку отправки переключает режим:
// отправка текста → запись голоса → запись видео.
library;

import 'dart:async';
import 'dart:io';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

import '../api_client.dart';
import '../call_service.dart';
import '../chat_store.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/emoji_picker.dart';
import '../widgets/markdown.dart';
import '../widgets/message_attachments.dart';
import 'call_picker.dart';
import 'call_screen.dart';

// Видео-сообщения ограничены 3 минутами, голосовые — нет.
const _videoLimitMs = 3 * 60 * 1000;

enum _SendMode { send, mic, cam }

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
  final AudioRecorder _audioRecorder = AudioRecorder();
  int? _editingId;
  ChatMessage? _replyTo;
  bool _sending = false;
  String? _sendError;

  // Режим кнопки отправки: текст / голос / видео (длинное нажатие).
  _SendMode _sendMode = _SendMode.send;
  CameraController? _camera;
  bool _cameraReady = false;
  bool _recording = false;
  Timer? _recTimer;
  int _recMs = 0;

  // Scroll / дата-плашка (как в web ChatPanel.vue)
  static const _scrollThresholdPx = 350.0;
  bool _showScrollButton = false;
  int _hiddenCount = 0;
  int _prevMessageCount = 0;
  bool _isAtBottom = true;
  bool _showPicker = false;

  int get _channelId => (widget.channel['id'] as num?)?.toInt() ?? 0;

  String _formatDateHeader(DateTime d) {
    final now = DateTime.now();
    final sameYear = d.year == now.year;
    const months = [
      'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
      'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'
    ];
    final s = sameYear
        ? '${d.day} ${months[d.month - 1]}'
        : '${d.day} ${months[d.month - 1]} ${d.year}';
    return s[0].toUpperCase() + s.substring(1);
  }

  bool _isNewDate(ChatMessage msg, int index, List<ChatMessage> list) {
    if (index == 0) return true;
    final prev = list[index - 1];
    return msg.createdAt.year != prev.createdAt.year ||
        msg.createdAt.month != prev.createdAt.month ||
        msg.createdAt.day != prev.createdAt.day;
  }

  void _scrollBottom() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
    setState(() {
      _hiddenCount = 0;
      _showScrollButton = false;
      _isAtBottom = true;
    });
  }

  String _typingSummary() {
    final t = widget.chat.typingUsers(_channelId);
    if (t.isEmpty) return '';
    final visible = t.take(4).map((e) => e.nick).join(', ');
    final verb = t.length == 1 ? 'печатает' : 'печатают';
    if (t.length > 4) {
      final rest = t.length - 4;
      return '$visible и ещё $rest ${rest == 1 ? 'печатает' : 'печатают'}…';
    }
    return '$visible $verb…';
  }

  @override
  void initState() {
    super.initState();
    widget.session.currentChannelId = _channelId;
    widget.session.joinChannel(_channelId);
    widget.chat.addListener(_onChatChanged);
    widget.chat.loadHistory(_channelId);
    _scroll.addListener(_onScroll);
    _input.addListener(() {
      if (_input.text.trim().isNotEmpty) {
        widget.chat.typing(_channelId);
      }
    });
  }

  @override
  void dispose() {
    widget.chat.removeListener(_onChatChanged);
    widget.session.leaveChannel(_channelId);
    if (widget.session.currentChannelId == _channelId) {
      widget.session.currentChannelId = null;
    }
    _recTimer?.cancel();
    _audioRecorder.dispose();
    _camera?.dispose();
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onChatChanged() {
    if (!mounted) return;
    final list = widget.chat.messages(_channelId);
    final count = list.length;
    final wasAtBottom = _isAtBottom;
    final oldEmpty = _prevMessageCount == 0;
    if (wasAtBottom || oldEmpty) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _scrollBottom());
    } else if (count > _prevMessageCount) {
      setState(() => _hiddenCount += count - _prevMessageCount);
    }
    _prevMessageCount = count;
    setState(() {});
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    final pos = _scroll.position;
    // пагинация
    if (pos.pixels < 120) {
      widget.chat.loadOlder(_channelId);
    }
    final distance = pos.maxScrollExtent - pos.pixels;
    final atBottom = distance < 80;
    final showBtn = distance > _scrollThresholdPx;
    if (atBottom != _isAtBottom || showBtn != _showScrollButton) {
      setState(() {
        _isAtBottom = atBottom;
        _showScrollButton = showBtn;
        if (atBottom) _hiddenCount = 0;
      });
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
    final ok = await widget.chat.send(_channelId, text, replyToId: _replyTo?.id);
    if (mounted) {
      setState(() {
        _sending = false;
        _sendError = ok ? null : 'Ключ канала ещё не получен, повторите позже';
        if (ok) _replyTo = null;
      });
      if (ok) _input.clear();
    }
  }

  void _insertEmoji(String e) {
    final t = _input.text;
    final sel = _input.selection;
    final pos = sel.isValid ? sel.baseOffset : t.length;
    final nt = t.substring(0, pos < 0 ? t.length : pos) + e + t.substring(pos < 0 ? t.length : pos);
    _input.text = nt;
    _input.selection = TextSelection.collapsed(offset: (pos < 0 ? t.length : pos) + e.length);
    setState(() {});
  }

  Future<void> _sendGif(String url) async {
    setState(() => _showPicker = false);
    final ok = await widget.chat.send(_channelId, '![gif]($url)');
    if (!ok && mounted) setState(() => _sendError = 'Ключ канала ещё не получен');
  }

  // ---------- Голосовые и видео-сообщения ----------

  /// Длинное нажатие на кнопку отправки: смена режима (текст → голос → видео).
  Future<void> _cycleMode() async {
    if (_recording) return;
    setState(() {
      _sendMode = _SendMode.values[(_sendMode.index + 1) % _SendMode.values.length];
    });
    if (_sendMode == _SendMode.cam) {
      await _initCamera();
    }
  }

  Future<void> _initCamera() async {
    if (_cameraReady) return;
    try {
      final cams = await availableCameras();
      if (cams.isEmpty) return;
      final c = CameraController(cams.first, ResolutionPreset.low, enableAudio: true);
      await c.initialize();
      _camera = c;
      _cameraReady = true;
      if (mounted) setState(() {});
    } catch (_) {
      _cameraReady = false;
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(msg), duration: const Duration(seconds: 3)));
  }

  Future<void> _onSendTap() async {
    switch (_sendMode) {
      case _SendMode.send:
        await _send();
      case _SendMode.mic:
        if (_recording) {
          await _stopRecording();
        } else {
          await _startAudioRecording();
        }
      case _SendMode.cam:
        if (_recording) {
          await _stopRecording();
        } else {
          await _startVideoRecording();
        }
    }
  }

  Future<void> _startAudioRecording() async {
    if (!await _audioRecorder.hasPermission()) {
      _showError('Нет доступа к микрофону — проверьте разрешения');
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/voice-${DateTime.now().millisecondsSinceEpoch}.m4a';
    try {
      await _audioRecorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 96000),
        path: path,
      );
    } catch (_) {
      _showError('Не удалось начать запись');
      return;
    }
    _startRecUi();
  }

  Future<void> _startVideoRecording() async {
    if (!_cameraReady) {
      await _initCamera();
    }
    final cam = _camera;
    if (!_cameraReady || cam == null || !cam.value.isInitialized) {
      _showError('Камера недоступна — проверьте разрешения');
      return;
    }
    try {
      await cam.startVideoRecording();
    } catch (_) {
      _showError('Не удалось начать запись видео');
      return;
    }
    _startRecUi();
  }

  void _startRecUi() {
    setState(() {
      _recording = true;
      _recMs = 0;
    });
    _recTimer?.cancel();
    _recTimer = Timer.periodic(const Duration(milliseconds: 250), (_) {
      if (!mounted) return;
      setState(() => _recMs += 250);
      // Видео — максимум 3 минуты.
      if (_sendMode == _SendMode.cam && _recMs >= _videoLimitMs) {
        _showError('Видео-сообщение достигло 3 минут — запись остановлена');
        _stopRecording();
      }
    });
  }

  Future<void> _stopRecording() async {
    _recTimer?.cancel();
    setState(() => _recording = false);
    String? path;
    var mime = 'audio/mp4';
    try {
      if (_sendMode == _SendMode.mic) {
        path = await _audioRecorder.stop();
      } else {
        final f = await _camera?.stopVideoRecording();
        path = f?.path;
        mime = 'video/mp4';
      }
    } catch (_) {
      path = null;
    }
    if (path == null) return;
    await _sendRecording(File(path), mime);
  }

  Future<void> _sendRecording(File file, String mime) async {
    setState(() => _sending = true);
    try {
      final bytes = await file.readAsBytes();
      final up = await widget.session.api
          .uploadFile(_channelId, bytes, file.uri.pathSegments.last, mime);
      final att = Attachment(
        id: (up['id'] as num?)?.toInt() ?? 0,
        filename: (up['filename'] as String?) ?? file.uri.pathSegments.last,
        mime: mime,
        size: bytes.length,
      );
      final text = _input.text.trim();
      final ok = await widget.chat.send(_channelId, text, attachments: [att], replyToId: _replyTo?.id);
      if (mounted) {
        setState(() {
          _sending = false;
          _sendError = ok ? null : 'Ключ канала ещё не получен, повторите позже';
          if (ok) _replyTo = null;
        });
        if (ok) _input.clear();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _sending = false;
          _sendError = 'Не удалось отправить запись';
        });
      }
    } finally {
      try {
        file.delete();
      } catch (_) {}
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

  String _roleIcon(Map m) {
    if (m['is_server_admin'] == true) return '👑';
    final r = (m['role'] as String?) ?? 'user';
    if (r == 'channel_admin') return '🛡️';
    if (r == 'channel_moderator') return '⚔️';
    return '👤';
  }

  /// Инфо о канале — как web ParticipantsPanel + ChannelSidebar header.
  Future<void> _showInfo() async {
    final colors = AppColors.of(context);
    final name = (widget.channel['name'] as String?) ?? '?';
    final created = widget.channel['created_at'] as String?;
    List<dynamic> members = [];
    List<dynamic> banned = [];
    try {
      members = await widget.session.api.members(_channelId);
      banned = await widget.session.api.bannedMembers(_channelId).catchError((_) => <dynamic>[]);
    } catch (_) {}
    if (!mounted) return;
    final myId = widget.session.settings.user?.id ?? 0;
    final isServerAdmin = widget.session.settings.user?.isServerAdmin ?? false;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.bg2,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.65,
        minChildSize: 0.4,
        maxChildSize: 0.92,
        expand: false,
        builder: (_, ctrl) => Column(
          children: [
            const SizedBox(height: 8),
            Container(width: 36, height: 4, decoration: BoxDecoration(color: colors.textDim.withValues(alpha: 0.3), borderRadius: BorderRadius.circular(2))),
            Expanded(
              child: ListView(
                controller: ctrl,
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                children: [
                  Center(child: _LetterAvatar(name: name, size: 88)),
                  const SizedBox(height: 12),
                  Center(child: Text(name, textAlign: TextAlign.center, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700))),
                  const SizedBox(height: 4),
                  Center(child: Text('Канал · ID: $_channelId', style: TextStyle(color: colors.textDim, fontSize: 13))),
                  if (created != null)
                    Center(child: Text('Создан: ${DateTime.tryParse(created)?.toLocal().toString().substring(0, 10) ?? ''}', style: TextStyle(color: colors.textDim, fontSize: 12))),
                  const SizedBox(height: 16),
                  Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                    _QuickAction(icon: Icons.call, label: 'Звонок', onTap: () { Navigator.pop(ctx); _startCall(); }),
                    const SizedBox(width: 12),
                    _QuickAction(icon: Icons.person_add, label: 'Пригласить', onTap: () { Navigator.pop(ctx); _showInviteToChannel(members); }),
                    const SizedBox(width: 12),
                    _QuickAction(icon: Icons.search, label: 'Поиск', onTap: () { Navigator.pop(ctx); _showSearch(); }),
                  ]),
                  const Divider(height: 24),
                  Row(
                    children: [
                      Text('Участники', style: TextStyle(color: colors.text, fontSize: 13, fontWeight: FontWeight.w700)),
                      const SizedBox(width: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(color: colors.bg3, borderRadius: BorderRadius.circular(999)),
                        child: Text('${members.length}', style: TextStyle(color: colors.textDim, fontSize: 11)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  for (final m in members)
                    Container(
                      margin: const EdgeInsets.only(bottom: 6),
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                      decoration: BoxDecoration(color: colors.bg, borderRadius: BorderRadius.circular(8), border: Border.all(color: colors.border)),
                      child: Row(
                        children: [
                          _LetterAvatar(name: (m['nick'] as String?) ?? '?', size: 36),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Text('${_roleIcon(m)} ${(m['nick'] as String?) ?? '?'}',
                                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis),
                              Text('ID: ${m['user_id']} · ${(m['role'] as String?) ?? 'user'}',
                                  style: TextStyle(color: colors.textDim, fontSize: 11)),
                            ]),
                          ),
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.end,
                            children: [
                              Text((m['online'] == true ? 'Онлайн' : 'Офлайн'),
                                  style: TextStyle(color: m['online'] == true ? colors.green : colors.textDim, fontSize: 11)),
                              if (isServerAdmin && (m['user_id'] as num?)?.toInt() != myId)
                                PopupMenuButton<String>(
                                  icon: Icon(Icons.more_horiz, color: colors.textDim, size: 18),
                                  onSelected: (v) async {
                                    final uid = (m['user_id'] as num).toInt();
                                    if (v == 'kick') {
                                      await widget.session.api.kickMember(_channelId, uid, 'кик из мобильного').catchError((e) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))));
                                      if (context.mounted) Navigator.pop(ctx);
                                    } else if (v == 'ban') {
                                      await widget.session.api.banMember(_channelId, uid, 'бан из мобильного').catchError((e) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))));
                                      if (context.mounted) Navigator.pop(ctx);
                                    } else if (v.startsWith('role:')) {
                                      final role = v.split(':')[1];
                                      await widget.session.api.setMemberRole(_channelId, uid, role).catchError((e) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))));
                                      if (context.mounted) Navigator.pop(ctx);
                                    }
                                  },
                                  itemBuilder: (_) => [
                                    const PopupMenuItem(value: 'role:user', child: Text('👤 Пользователь')),
                                    const PopupMenuItem(value: 'role:channel_moderator', child: Text('⚔️ Модератор')),
                                    const PopupMenuItem(value: 'role:channel_admin', child: Text('🛡️ Админ канала')),
                                    const PopupMenuItem(value: 'kick', child: Text('Кик')),
                                    const PopupMenuItem(value: 'ban', child: Text('Бан')),
                                  ],
                                ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  if (members.isEmpty)
                    Padding(padding: const EdgeInsets.all(16), child: Center(child: Text('Нет участников', style: TextStyle(color: colors.textDim)))),
                  if (banned.isNotEmpty) ...[
                    const Divider(height: 24),
                    Text('Забаненные (${banned.length})', style: TextStyle(color: colors.danger, fontSize: 13, fontWeight: FontWeight.w700)),
                    const SizedBox(height: 8),
                    for (final b in banned)
                      Container(
                        margin: const EdgeInsets.only(bottom: 6),
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                        decoration: BoxDecoration(color: colors.bg3, borderRadius: BorderRadius.circular(8)),
                        child: Row(
                          children: [
                            Expanded(child: Text((b['nick'] as String?) ?? 'ID:${b['user_id']}', style: TextStyle(color: colors.text, fontSize: 13))),
                            TextButton(onPressed: () async { await widget.session.api.unbanMember(_channelId, (b['user_id'] as num).toInt()); if (context.mounted) Navigator.pop(ctx); }, child: const Text('Разбанить', style: TextStyle(color: Color(0xFF23A55A)))),
                          ],
                        ),
                      ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _showInviteToChannel(List<dynamic> currentMembers) async {
    final colors = AppColors.of(context);
    final memberIds = currentMembers.map((m) => (m['user_id'] as num).toInt()).toSet();
    List<dynamic> users = [];
    try {
      users = await widget.session.api.users();
    } catch (_) {}
    final candidates = users.where((u) => !memberIds.contains((u['id'] as num?)?.toInt())).toList();
    if (!mounted) return;
    final picked = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: colors.bg2,
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Text('Пригласить пользователя', style: TextStyle(color: colors.text, fontSize: 16, fontWeight: FontWeight.w700)),
            const SizedBox(height: 12),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final u in candidates)
                    ListTile(
                      title: Text((u['nick'] as String?) ?? '?', style: TextStyle(color: colors.text)),
                      subtitle: Text('ID: ${u['id']}', style: TextStyle(color: colors.textDim, fontSize: 12)),
                      onTap: () => Navigator.pop(ctx, (u['id'] as num).toInt()),
                    ),
                  if (candidates.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Center(child: Text('Нет пользователей для приглашения', style: TextStyle(color: colors.textDim)))),
                ],
              ),
            ),
          ]),
        ),
      ),
    );
    if (picked != null) {
      try {
        await widget.session.api.inviteToChannel(_channelId, picked);
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Приглашение отправлено')));
      } catch (e) {
        if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Ошибка: $e')));
      }
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
    final colors = AppColors.of(context);
    final myId = widget.session.settings.user?.id;
    final isMine = m.senderId == myId;
    final canEdit = isMine && !m.deleted && !m.encrypted && !m.system;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.reply),
              title: const Text('Ответить'),
              onTap: () => Navigator.pop(ctx, 'reply'),
            ),
            ListTile(
              leading: const Icon(Icons.copy),
              title: const Text('Копировать текст'),
              onTap: () => Navigator.pop(ctx, 'copy'),
            ),
            if (canEdit)
              ListTile(
                leading: const Icon(Icons.edit),
                title: const Text('Изменить сообщение'),
                onTap: () => Navigator.pop(ctx, 'edit'),
              ),
            if (isMine && !m.deleted)
              ListTile(
                leading: Icon(Icons.delete, color: colors.danger),
                title: Text('Удалить сообщение', style: TextStyle(color: colors.danger)),
                onTap: () => Navigator.pop(ctx, 'delete'),
              ),
            if (m.deleted && m.original != null)
              ListTile(
                leading: const Icon(Icons.visibility),
                title: const Text('Показать оригинал'),
                onTap: () => Navigator.pop(ctx, 'original'),
              ),
          ],
        ),
      ),
    );
    if (!mounted) return;
    if (action == 'reply') {
      setState(() => _replyTo = m);
    } else if (action == 'copy') {
      // копирование в буфер — через SnackBar для простоты
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m.text ?? ''), duration: const Duration(seconds: 1)));
    } else if (action == 'edit') {
      _startEdit(m);
    } else if (action == 'delete') {
      await widget.chat.remove(_channelId, m.id);
    } else if (action == 'original') {
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Оригинал сообщения'),
          content: Text(m.original ?? ''),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Закрыть'))],
        ),
      );
    }
  }

  void _jumpToMessage(int id) {
    final idx = widget.chat.messages(_channelId).indexWhere((x) => x.id == id);
    if (idx < 0 || !_scroll.hasClients) return;
    _scroll.animateTo(
      (idx / (widget.chat.messages(_channelId).length)) * _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOut,
    );
  }

  Future<void> _showSearch() async {
    final colors = AppColors.of(context);
    final qCtrl = TextEditingController();
    List<ChatMessage> results = [];
    bool loading = false;
    Timer? debounce;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: colors.bg2,
      builder: (ctx) => StatefulBuilder(builder: (ctx2, setSt) {
        Future<void> doSearch(String q) async {
          if (q.trim().isEmpty) { setSt(() => results = []); return; }
          setSt(() => loading = true);
          final r = await widget.chat.searchMessages(_channelId, q);
          if (ctx2.mounted) setSt(() { results = r; loading = false; });
        }
        return Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx2).viewInsets.bottom),
          child: SafeArea(
            child: SizedBox(
              height: MediaQuery.of(ctx2).size.height * 0.75,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: qCtrl,
                            autofocus: true,
                            decoration: InputDecoration(
                              hintText: 'Поиск сообщений…',
                              prefixIcon: const Icon(Icons.search, size: 20),
                              filled: true,
                              fillColor: colors.bg,
                              isDense: true,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                            ),
                            onChanged: (v) {
                              debounce?.cancel();
                              debounce = Timer(const Duration(milliseconds: 300), () => doSearch(v));
                            },
                          ),
                        ),
                        const SizedBox(width: 8),
                        IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx2)),
                      ],
                    ),
                  ),
                  if (loading) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: results.isEmpty
                        ? Center(child: Text(qCtrl.text.trim().isEmpty ? 'Введите запрос' : widget.chat.searchBusy ? 'Поиск…' : 'Ничего не найдено', style: TextStyle(color: colors.textDim)))
                        : ListView.builder(
                            itemCount: results.length,
                            itemBuilder: (_, i) {
                              final m = results[i];
                              return ListTile(
                                title: Text(m.senderNick, style: TextStyle(color: colors.accent, fontSize: 13, fontWeight: FontWeight.w600)),
                                subtitle: Text(m.text ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: colors.text, fontSize: 13)),
                                trailing: Text('${m.createdAt.hour.toString().padLeft(2, '0')}:${m.createdAt.minute.toString().padLeft(2, '0')}', style: TextStyle(color: colors.textDim, fontSize: 11)),
                                onTap: () {
                                  Navigator.pop(ctx2);
                                  _jumpToMessage(m.id);
                                },
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        );
      }),
    );
    debounce?.cancel();
    qCtrl.dispose();
  }

  Future<void> _showMedia() async {
    final colors = AppColors.of(context);
    final media = widget.chat.mediaMessages(_channelId);
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: colors.bg2,
      builder: (ctx) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(ctx).size.height * 0.6,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: [
                    Text('Медиа', style: TextStyle(color: colors.text, fontSize: 16, fontWeight: FontWeight.w700)),
                    const Spacer(),
                    IconButton(icon: const Icon(Icons.close), onPressed: () => Navigator.pop(ctx)),
                  ],
                ),
              ),
              Expanded(
                child: media.isEmpty
                    ? Center(child: Text('Нет фото и видео', style: TextStyle(color: colors.textDim)))
                    : GridView.builder(
                        padding: const EdgeInsets.all(8),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 4, mainAxisSpacing: 4),
                        itemCount: media.expand((m) => m.attachments.where((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'))).length,
                        itemBuilder: (_, idx) {
                          final allAtts = media.expand((m) => m.attachments.where((a) => a.mime.startsWith('image/') || a.mime.startsWith('video/'))).toList();
                          final a = allAtts[idx];
                          return GestureDetector(
                            onTap: () {
                              // открыть соответствующий _MessageAttachments превью
                              Navigator.pop(ctx);
                            },
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(6),
                              child: a.mime.startsWith('image/')
                                  ? Image.network(widget.session.api.fileUrl(a.id), fit: BoxFit.cover, errorBuilder: (_,__,___) => Container(color: colors.bg3, child: Icon(Icons.broken_image, color: colors.textDim)))
                                  : Container(color: Colors.black, child: const Center(child: Icon(Icons.play_circle_fill, color: Colors.white, size: 32))),
                            ),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final messages = widget.chat.messages(_channelId);
    final channelName = (widget.channel['name'] as String?) ?? '?';
    final typing = _typingSummary();

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
          IconButton(icon: Icon(Icons.search, color: colors.textDim, size: 20), tooltip: 'Поиск', onPressed: _showSearch),
          IconButton(icon: Icon(Icons.perm_media, color: colors.textDim, size: 20), tooltip: 'Медиа', onPressed: _showMedia),
          IconButton(
            icon: Icon(Icons.call, color: colors.accent),
            tooltip: 'Позвонить участникам канала',
            onPressed: _startCall,
          ),
          IconButton(
            icon: const Icon(Icons.more_vert),
            tooltip: 'Инфо канала',
            onPressed: _showInfo,
          ),
        ],
        bottom: typing.isNotEmpty
            ? PreferredSize(
                preferredSize: const Size.fromHeight(24),
                child: Container(
                  width: double.infinity,
                  color: colors.bg2,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  child: Text(typing,
                      style: TextStyle(color: colors.accent, fontSize: 12.5, fontStyle: FontStyle.italic),
                      overflow: TextOverflow.ellipsis),
                ),
              )
            : null,
      ),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                ListView.builder(
                  controller: _scroll,
                  padding: const EdgeInsets.all(12),
                  itemCount: messages.length,
                  itemBuilder: (ctx, i) {
                    final m = messages[i];
                    final mine = m.senderId == widget.session.settings.user?.id;
                    final showDate = _isNewDate(m, i, messages);
                    return Column(
                      children: [
                        if (showDate)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 8),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                              decoration: BoxDecoration(
                                color: colors.bg3,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(_formatDateHeader(m.createdAt),
                                  style: TextStyle(color: colors.textDim, fontSize: 12, fontWeight: FontWeight.w600)),
                            ),
                          ),
                        if (m.system)
                          Padding(
                            padding: const EdgeInsets.symmetric(vertical: 4),
                            child: Container(
                              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                              decoration: BoxDecoration(
                                color: colors.bg3,
                                borderRadius: BorderRadius.circular(999),
                              ),
                              child: Text(m.text ?? '',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: colors.textDim, fontSize: 12)),
                            ),
                          )
                        else
                          Builder(builder: (_) {
                            ChatMessage? replied;
                            if (m.replyToId != null) {
                              try {
                                replied = messages.firstWhere((x) => x.id == m.replyToId);
                              } catch (_) {}
                            }
                            return _MessageBubble(
                              m: m,
                              mine: mine,
                              replied: replied,
                              onLongPress: () => _onLongPress(m),
                              onReplyTap: replied != null ? () => _jumpToMessage(replied!.id) : null,
                              api: widget.session.api,
                            );
                          }),
                      ],
                    );
                  },
                ),
                if (_showScrollButton)
                  Positioned(
                    right: 12,
                    bottom: 12,
                    child: GestureDetector(
                      onTap: _scrollBottom,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                        decoration: BoxDecoration(
                          color: colors.accent,
                          borderRadius: BorderRadius.circular(999),
                          boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.2), blurRadius: 8, offset: const Offset(0, 2))],
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.arrow_downward, color: Colors.white, size: 16),
                            if (_hiddenCount > 0) ...[
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999)),
                                child: Text('$_hiddenCount',
                                    style: TextStyle(color: colors.accent, fontSize: 11, fontWeight: FontWeight.w700)),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (_sendError != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text(_sendError!, style: TextStyle(color: colors.danger, fontSize: 12)),
            ),
          // Индикатор идущей записи: красная точка + таймер.
          if (_recording)
            Container(
              width: double.infinity,
              color: colors.surface,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: colors.danger,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${_sendMode == _SendMode.mic ? 'Голосовое' : 'Видео'}: '
                    '${(_recMs ~/ 60000)}:${((_recMs ~/ 1000) % 60).toString().padLeft(2, '0')}'
                    '${_sendMode == _SendMode.cam ? ' · макс. 3:00' : ''} — нажмите ещё раз, чтобы остановить',
                    style: TextStyle(color: colors.danger, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            ),
          if (_replyTo != null)
            Container(
              width: double.infinity,
              color: colors.bg2,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: [
                  Container(width: 3, height: 32, decoration: BoxDecoration(color: colors.accent, borderRadius: BorderRadius.circular(2))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(_replyTo!.senderNick, style: TextStyle(color: colors.accent, fontSize: 12, fontWeight: FontWeight.w700)),
                      Text(_replyTo!.text ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: colors.textDim, fontSize: 12)),
                    ]),
                  ),
                  IconButton(icon: Icon(Icons.close, color: colors.textDim, size: 18), onPressed: () => setState(() => _replyTo = null)),
                ],
              ),
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
          if (_showPicker)
            EmojiPicker(
              api: widget.session.api,
              onInsert: _insertEmoji,
              onSendGif: _sendGif,
              onClose: () => setState(() => _showPicker = false),
            ),
          Container(
            color: colors.bg,
            decoration: BoxDecoration(
              color: colors.bg,
              border: Border(top: BorderSide(color: colors.border, width: 0.5)),
            ),
            padding: const EdgeInsets.fromLTRB(8, 10, 12, 14),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                IconButton(
                  icon: Icon(_showPicker ? Icons.keyboard : Icons.emoji_emotions_outlined, color: colors.textDim, size: 22),
                  tooltip: 'Смайлики и GIF',
                  onPressed: () => setState(() => _showPicker = !_showPicker),
                  style: IconButton.styleFrom(backgroundColor: _showPicker ? colors.bg3 : Colors.transparent, shape: const CircleBorder(), padding: const EdgeInsets.all(8)),
                ),
                const SizedBox(width: 4),
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 5,
                    style: TextStyle(color: colors.text, fontSize: 15, height: 1.35),
                    decoration: InputDecoration(
                      hintText: _editingId != null ? 'Редактирование…' : 'Сообщение в чат…',
                      hintStyle: TextStyle(color: colors.textDim, fontSize: 15),
                      fillColor: colors.bg3,
                      filled: true,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(24), borderSide: BorderSide.none),
                    ),
                    onSubmitted: (_) => _send(),
                    onChanged: (_) {
                      setState(() {});
                      if (_input.text.trim().isNotEmpty) widget.chat.typing(_channelId);
                    },
                  ),
                ),
                const SizedBox(width: 8),
                // Круглая кнопка отправки: длинное нажатие меняет режим
                // (текст → голос → видео), тап — отправить/запись.
                SizedBox(
                  width: 44,
                  height: 44,
                  child: IconButton(
                    padding: EdgeInsets.zero,
                    icon: Icon(
                      _recording
                          ? Icons.stop
                          : _sendMode == _SendMode.mic
                              ? Icons.mic
                              : _sendMode == _SendMode.cam
                                  ? Icons.videocam
                                  : Icons.send,
                      color: Colors.white,
                      size: 20,
                    ),
                    style: IconButton.styleFrom(
                      backgroundColor: _recording
                          ? colors.danger
                          : colors.accent,
                      disabledBackgroundColor: colors.accent.withValues(alpha: 0.4),
                    ),
                    tooltip: switch (_sendMode) {
                      _SendMode.send => 'Отправить (долгое нажатие — голос)',
                      _SendMode.mic => 'Голосовое сообщение (долгое нажатие — видео)',
                      _SendMode.cam => 'Видео-сообщение до 3 минут',
                    },
                    onPressed: _sending
                        ? null
                        : (_sendMode == _SendMode.send &&
                                _input.text.trim().isEmpty &&
                                !_recording)
                            ? null
                            : _onSendTap,
                    onLongPress: _cycleMode,
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
  final ChatMessage? replied;
  final VoidCallback onLongPress;
  final VoidCallback? onReplyTap;
  final ApiClient api;

  const _MessageBubble({
    required this.m,
    required this.mine,
    this.replied,
    required this.onLongPress,
    this.onReplyTap,
    required this.api,
  });

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

    final isLight = Theme.of(context).brightness == Brightness.light;
    final bubble = Container(
      constraints: const BoxConstraints(maxWidth: 320),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: mine ? colors.bubbleOut : colors.bubble,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(mine ? 14 : 4),
          topRight: Radius.circular(mine ? 4 : 14),
          bottomLeft: const Radius.circular(14),
          bottomRight: const Radius.circular(14),
        ),
        border: (!mine && isLight) ? Border.all(color: colors.border) : null,
        boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.06), blurRadius: 2, offset: const Offset(0, 1))],
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
          if (replied != null)
            GestureDetector(
              onTap: onReplyTap,
              child: Container(
                margin: const EdgeInsets.only(bottom: 4),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: mine ? Colors.white.withValues(alpha: 0.15) : colors.bg3,
                  borderRadius: BorderRadius.circular(6),
                  border: Border(left: BorderSide(color: mine ? Colors.white : colors.accent, width: 3)),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(replied!.senderNick, style: TextStyle(color: mine ? Colors.white : colors.accent, fontSize: 12, fontWeight: FontWeight.w700)),
                    Text(replied!.text ?? '', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: mine ? Colors.white70 : colors.textDim, fontSize: 12)),
                  ],
                ),
              ),
            ),
          // Вложения: фото/видео/голос/файлы (одно или несколько).
          MessageAttachments(m: m, mine: mine, api: api),
          if (body.isNotEmpty)
            m.pending || m.deleted || m.encrypted
                ? Text(body, style: bodyStyle)
                : MarkdownView(text: body, mine: mine),
          const SizedBox(height: 3),
          Align(
            alignment: Alignment.centerRight,
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (m.edited)
                  Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: Text('изменено',
                        style: TextStyle(
                            color: mine ? Colors.white.withValues(alpha: 0.7) : colors.textDim,
                            fontSize: 10,
                            fontStyle: FontStyle.italic)),
                  ),
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
