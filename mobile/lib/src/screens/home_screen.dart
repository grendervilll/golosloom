// Главный экран: список чатов (поиск, аватар/время/превью/счётчик),
// меню темы, смена аватара, проверка обновлений.
library;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../api_client.dart';
import '../call_service.dart';
import '../chat_store.dart';
import '../push_service.dart';
import '../session.dart';
import '../settings.dart';
import '../theme.dart';
import '../update_dialog.dart';
import '../widgets/avatar.dart';
import 'admin_screen.dart';
import 'call_screen.dart';
import 'chat_screen.dart';
import 'login_screen.dart';

class HomeScreen extends StatefulWidget {
  /// Глобальный чат-стор (для плашки звонка на любом экране).
  static ChatStore? globalChat;

  final AppSettings settings;

  const HomeScreen({super.key, required this.settings});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final ApiClient _api;
  late final Session _session;
  late final ChatStore _chat;
  late final CallService _calls;
  late final PushService _push;
  String _myNick = '';
  String _query = '';
  final Map<int, ChatMessage?> _last = {};
  bool _loadingLast = false;
  List<dynamic> _invites = [];

  static const _avatarColors = [
    Color(0xFF2AABEE), Color(0xFFEC4899), Color(0xFFEF4444),
    Color(0xFF10B981), Color(0xFF8B5CF6), Color(0xFFF59E0B),
    Color(0xFF14B8A6), Color(0xFF6366F1),
  ];

  @override
  void initState() {
    super.initState();
    _api = ApiClient(widget.settings.serverUrl ?? '')
      ..token = widget.settings.token;
    // Токен живёт сутки (или его отозвала смена пароля): при 401 —
    // очищаем сессию и возвращаем на экран входа.
    _api.onUnauthorized = () {
      widget.settings.clearAuth();
      if (mounted) {
        Navigator.of(context).pushAndRemoveUntil(
          MaterialPageRoute(builder: (_) => LoginScreen(settings: widget.settings)),
          (route) => false,
        );
      }
    };
    _myNick = widget.settings.user?.nick ?? '';
    _session = Session(widget.settings, _api);
    _chat = ChatStore(_session);
    HomeScreen.globalChat = _chat;
    _calls = CallService(_session, chat: _chat);
    _push = PushService(_api);
    _session.addListener(_onSessionChanged);
    _calls.addListener(_onCallsChanged);
    _session.start();
    _push.init();
    _checkUpdate();
    _loadInvites();
    // слушать инвайты через WS как web channels.handleInviteEvent
    _session.events.listen((e) {
      if (e.type == 'invite.new' || e.type == 'invite.pending' || e.type == 'invite.updated') {
        _loadInvites();
      }
    });
  }

  @override
  void dispose() {
    _session.removeListener(_onSessionChanged);
    _calls.removeListener(_onCallsChanged);
    if (HomeScreen.globalChat == _chat) HomeScreen.globalChat = null;
    _calls.dispose();
    _chat.dispose();
    _session.stop();
    super.dispose();
  }

  void _onSessionChanged() {
    if (!mounted) return;
    setState(() {});
    // Список каналов изменился — обновляем превью последних сообщений.
    if (_session.channels.isNotEmpty && !_loadingLast) {
      _loadingLast = true;
      Future(() async {
        final m = <int, ChatMessage?>{};
        for (final ch in _session.channels) {
          final id = (ch['id'] as num?)?.toInt() ?? 0;
          if (id == 0) continue;
          m[id] = await _chat.fetchLast(id);
        }
        if (mounted) setState(() => _last..addAll(m));
        _loadingLast = false;
      });
    }
  }

  void _onCallsChanged() {
    if (!mounted) return;
    final ring = _calls.ringing;
    if (ring != null && ring.incoming && !_calls.inCall) {
      _showIncomingCall(ring);
    }
  }

  Future<void> _showIncomingCall(CallInfo ring) async {
    final colors = AppColors.of(context);
    final accepted = await showDialog<bool>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: const Text('📞 Входящий звонок', textAlign: TextAlign.center),
        content: Text(
          '${ring.initiatorNick ?? 'Кто-то'} звонит в канале',
          textAlign: TextAlign.center,
          style: TextStyle(color: colors.textDim),
        ),
        actionsAlignment: MainAxisAlignment.center,
        actions: [
          TextButton(
            onPressed: () {
              _calls.decline(ring);
              Navigator.of(ctx).pop(false);
            },
            child: Text('Отклонить', style: TextStyle(color: colors.textDim)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: colors.online),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Принять'),
          ),
        ],
      ),
    );
    if (!mounted) return;
    if (accepted == true) {
      final ok = await _calls.accept(ring);
      if (ok && mounted) {
        await Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => CallScreen(session: _session, calls: _calls, chat: _chat),
          ),
        );
      }
    }
  }

  Future<void> _loadInvites() async {
    try {
      final inv = await _api.invites();
      if (mounted) setState(() => _invites = inv);
    } catch (_) {}
  }

  Future<void> _acceptInvite(int id) async {
    try {
      await _api.acceptInvite(id);
      await _session.refreshChannels();
      await _loadInvites();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Приглашение принято')));
    } catch (e) {
      _showError(e.toString());
    }
  }

  Future<void> _declineInvite(int id) async {
    try {
      await _api.declineInvite(id);
      await _loadInvites();
    } catch (e) {
      _showError(e.toString());
    }
  }

  Future<void> _checkUpdate() async {
    try {
      final pkg = await PackageInfo.fromPlatform();
      if (!mounted) return;
      await checkForUpdate(context, currentVersion: pkg.version);
    } catch (_) {
      /* проверка обновления не критична */
    }
  }

  Future<void> _logout() async {
    await widget.settings.clearAuth();
    if (mounted) Navigator.of(context).pushReplacementNamed('/login');
  }

  Future<void> _toggleTheme() async {
    await widget.settings.setDarkTheme(!widget.settings.darkTheme);
    if (mounted) setState(() {});
  }

  Future<void> _showCreateChannel() async {
    final colors = AppColors.of(context);
    final nameCtrl = TextEditingController();
    var isPrivate = false;
    var busy = false;
    String? error;
    final created = await showDialog<bool>(
      context: context,
      builder: (ctx) => StatefulBuilder(builder: (ctx2, setSt) => AlertDialog(
            title: const Text('Новый чат', textAlign: TextAlign.center),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: nameCtrl,
                  autofocus: true,
                  decoration: InputDecoration(
                    hintText: 'Название',
                    fillColor: colors.bg3,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Checkbox(
                        value: isPrivate,
                        activeColor: colors.accent,
                        onChanged: (v) => setSt(() => isPrivate = v ?? false)),
                    const Text('Приватный'),
                  ],
                ),
                if (error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(error!, style: TextStyle(color: colors.danger, fontSize: 12)),
                  ),
              ],
            ),
            actionsAlignment: MainAxisAlignment.center,
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx2, false), child: const Text('Отмена')),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: colors.accent),
                onPressed: busy
                    ? null
                    : () async {
                        final n = nameCtrl.text.trim();
                        if (n.isEmpty) {
                          setSt(() => error = 'Введите название');
                          return;
                        }
                        setSt(() => busy = true);
                        try {
                          await _api.createChannel(n, isPrivate);
                          await _session.refreshChannels();
                          if (ctx2.mounted) Navigator.pop(ctx2, true);
                        } catch (e) {
                          setSt(() {
                            error = e.toString();
                            busy = false;
                          });
                        }
                      },
                child: busy
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Text('Создать'),
              ),
            ],
          )),
    );
    if (created == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Чат создан')));
    }
  }

  /// Меню аватара: сменить (до 5 МБ) или удалить.
  Future<void> _avatarMenu() async {
    final colors = AppColors.of(context);
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text('Аватар (максимум 5 МБ)',
                  style: TextStyle(color: colors.textDim, fontSize: 12)),
            ),
            ListTile(
              leading: const Icon(Icons.photo),
              title: const Text('Изменить аватар'),
              onTap: () => Navigator.pop(ctx, 'change'),
            ),
            ListTile(
              leading: Icon(Icons.delete, color: colors.danger),
              title: Text('Удалить аватар', style: TextStyle(color: colors.danger)),
              onTap: () => Navigator.pop(ctx, 'remove'),
            ),
          ],
        ),
      ),
    );
    if (!mounted || action == null) return;
    if (action == 'remove') {
      try {
        await _api.deleteAvatar();
        await _session.refreshUsers();
      } catch (e) {
        _showError(e.toString());
      }
      return;
    }
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1024, maxHeight: 1024);
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) {
      _showError('Аватар слишком большой: максимум 5 МБ');
      return;
    }
    try {
      await _api.uploadAvatar(bytes, 'avatar.jpg');
      await _session.refreshUsers();
    } catch (e) {
      _showError(e.toString());
    }
  }

  void _showError(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _openChat(Map<String, dynamic> ch) async {
    final id = (ch['id'] as num?)?.toInt() ?? 0;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          session: _session,
          chat: _chat,
          calls: _calls,
          channel: ch,
        ),
      ),
    );
    if (mounted) {
      setState(() {}); // сброс непрочитанных после возврата
      final m = await _chat.fetchLast(id);
      if (mounted) setState(() => _last[id] = m);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final channels = _session.channels;
    final q = _query.trim().toLowerCase();
    final filtered = q.isEmpty
        ? channels
        : channels.where((c) => ((c['name'] as String?) ?? '').toLowerCase().contains(q)).toList();

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        title: Text('Golosloom',
            style: TextStyle(color: colors.text, fontSize: 18, fontWeight: FontWeight.w700)),
        actions: [
          IconButton(
            onPressed: _showCreateChannel,
            tooltip: 'Создать чат',
            icon: Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(color: colors.accent, shape: BoxShape.circle),
              child: const Icon(Icons.add, color: Colors.white, size: 20),
            ),
          ),
          IconButton(
            onPressed: _toggleTheme,
            tooltip: widget.settings.darkTheme ? 'Светлая тема' : 'Тёмная тема',
            icon: Icon(
              widget.settings.darkTheme ? Icons.light_mode : Icons.dark_mode,
              color: colors.textDim,
            ),
          ),
          IconButton(
            onPressed: _avatarMenu,
            tooltip: 'Аватар',
            icon: AvatarWidget(
              session: _session,
              userId: widget.settings.user?.id ?? 0,
              nick: _myNick,
              size: 30,
            ),
          ),
          if (widget.settings.user?.isServerAdmin == true)
            IconButton(
              icon: Icon(Icons.admin_panel_settings, color: colors.yellow),
              tooltip: 'Админ панель',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => AdminScreen(session: _session)),
                );
              },
            ),
          IconButton(
            icon: Icon(Icons.logout, color: colors.textDim),
            tooltip: 'Выйти',
            onPressed: _logout,
          ),
        ],
      ),
      body: _session.error != null && channels.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_session.error!, style: TextStyle(color: colors.danger)),
                  const SizedBox(height: 8),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: colors.accent),
                    onPressed: () {
                      _session.refreshChannels();
                    },
                    child: const Text('Повторить'),
                  ),
                ],
              ),
            )
          : Column(
              children: [
                // Поиск по чатам — как в web ChannelSidebar (bg3, radius18, 36px).
                Padding(
                  padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
                  child: TextField(
                    onChanged: (v) => setState(() => _query = v),
                    style: TextStyle(color: colors.text, fontSize: 15),
                    decoration: InputDecoration(
                      hintText: 'Поиск',
                      hintStyle: TextStyle(color: colors.textDim, fontSize: 15),
                      prefixIcon: Icon(Icons.search, color: colors.textDim, size: 19),
                      filled: true,
                      fillColor: colors.bg3,
                      isDense: true,
                      contentPadding: const EdgeInsets.symmetric(vertical: 10),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                    ),
                  ),
                ),
                if (_invites.isNotEmpty)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    color: colors.bg2,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Приглашения', style: TextStyle(color: colors.textDim, fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.5)),
                        const SizedBox(height: 4),
                        for (final inv in _invites)
                          Container(
                            margin: const EdgeInsets.only(bottom: 6),
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                            decoration: BoxDecoration(color: colors.bg, border: Border.all(color: colors.border), borderRadius: BorderRadius.circular(8)),
                            child: Row(
                              children: [
                                Expanded(child: Text(inv['channel_name']?.toString() ?? 'Приглашение #${inv['id']}', style: TextStyle(color: colors.text, fontSize: 13, fontWeight: FontWeight.w600))),
                                const SizedBox(width: 8),
                                FilledButton(
                                  style: FilledButton.styleFrom(backgroundColor: colors.green, padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6), minimumSize: Size.zero),
                                  onPressed: () => _acceptInvite((inv['id'] as num).toInt()),
                                  child: const Text('Принять', style: TextStyle(color: Colors.white, fontSize: 12)),
                                ),
                                const SizedBox(width: 6),
                                OutlinedButton(
                                  style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6), minimumSize: Size.zero, side: BorderSide(color: colors.border)),
                                  onPressed: () => _declineInvite((inv['id'] as num).toInt()),
                                  child: Text('Отклонить', style: TextStyle(color: colors.textDim, fontSize: 12)),
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: _session.refreshChannels,
                    child: filtered.isEmpty
                        ? ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: [
                              Padding(
                                padding: const EdgeInsets.all(32),
                                child: Text(
                                  channels.isEmpty ? 'Чатов пока нет' : 'Ничего не найдено',
                                  textAlign: TextAlign.center,
                                  style: TextStyle(color: colors.textDim, fontSize: 14),
                                ),
                              ),
                            ],
                          )
                        : ListView.builder(
                            physics: const AlwaysScrollableScrollPhysics(),
                            itemCount: filtered.length,
                            itemBuilder: (ctx, i) {
                              final ch = filtered[i];
                              final id = (ch['id'] as num?)?.toInt() ?? 0;
                              final name = (ch['name'] as String?) ?? '?';
                              final isPrivate = (ch['private'] as bool?) ?? false;
                              final last = _last[id];
                              final unread = _chat.unread(id);
                              return _ChatRow(
                                name: name,
                                isPrivate: isPrivate,
                                last: last,
                                unread: unread,
                                color: _avatarColors[id % _avatarColors.length],
                                myId: widget.settings.user?.id ?? 0,
                                onTap: () => _openChat(ch),
                              );
                            },
                          ),
                  ),
                ),
              ],
            ),
    );
  }
}

class _ChatRow extends StatelessWidget {
  final String name;
  final bool isPrivate;
  final ChatMessage? last;
  final int unread;
  final Color color;
  final int myId;
  final VoidCallback onTap;

  const _ChatRow({
    required this.name,
    required this.isPrivate,
    required this.last,
    required this.unread,
    required this.color,
    required this.myId,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final time = last != null ? chatTime(last!.createdAt) : '';
    String preview;
    var dim = true;
    if (last == null) {
      preview = 'Нет сообщений';
    } else if (last!.encrypted) {
      preview = '🔒 Сообщение';
    } else if (last!.deleted) {
      preview = '🗑 Сообщение удалено';
    } else {
      final isMine = last!.senderId == myId;
      final raw = last!.text ?? '';
      preview = isMine ? 'Вы: $raw' : raw;
      dim = false;
    }

    final divider = colors.border;

    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(border: Border(bottom: BorderSide(color: divider, width: 0.5))),
        child: Row(
          children: [
            _LetterAvatar(name: name, color: color, size: 48),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          '${isPrivate ? '🔒 ' : ''}$name',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                        ),
                      ),
                      if (time.isNotEmpty)
                        Text('  $time', style: TextStyle(color: colors.textDim, fontSize: 12)),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          preview,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: dim ? colors.textDim : colors.text.withValues(alpha: 0.85),
                            fontSize: 13,
                          ),
                        ),
                      ),
                      if (unread > 0)
                        Container(
                          margin: const EdgeInsets.only(left: 8),
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: colors.accent,
                            borderRadius: BorderRadius.circular(100),
                          ),
                          child: Text(
                            '$unread',
                            style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.w600),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Аватар-буква с цветом канала (как в макете списка чатов).
class _LetterAvatar extends StatelessWidget {
  final String name;
  final Color color;
  final double size;

  const _LetterAvatar({required this.name, required this.color, required this.size});

  @override
  Widget build(BuildContext context) {
    final letter = name.isEmpty ? '?' : name[0].toUpperCase();
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: TextStyle(color: Colors.white, fontSize: size * 0.48, fontWeight: FontWeight.w600),
      ),
    );
  }
}
