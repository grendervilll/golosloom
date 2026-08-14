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
  bool _sending = false;
  String? _sendError;

  // Режим кнопки отправки: текст / голос / видео (длинное нажатие).
  _SendMode _sendMode = _SendMode.send;
  CameraController? _camera;
  bool _cameraReady = false;
  bool _recording = false;
  Timer? _recTimer;
  int _recMs = 0;

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
    _recTimer?.cancel();
    _audioRecorder.dispose();
    _camera?.dispose();
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
      final ok = await widget.chat.send(_channelId, text, attachments: [att]);
      if (mounted) {
        setState(() {
          _sending = false;
          _sendError = ok ? null : 'Ключ канала ещё не получен, повторите позже';
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
                return _MessageBubble(
                  m: m,
                  mine: mine,
                  onLongPress: () => _onLongPress(m),
                  api: widget.session.api,
                );
              },
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
  final VoidCallback onLongPress;
  final ApiClient api;

  const _MessageBubble({
    required this.m,
    required this.mine,
    required this.onLongPress,
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
          // Вложения: фото/видео/голос/файлы (одно или несколько).
          MessageAttachments(m: m, mine: mine, api: api),
          if (body.isNotEmpty) Text(body, style: bodyStyle),
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
