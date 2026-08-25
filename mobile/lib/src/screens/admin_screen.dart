// ignore_for_file: unnecessary_underscores
// Админ-панель сервера: статистика, пользователи, каналы, регистрация.
library;

import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';

import '../api_client.dart';
import '../session.dart';

class AdminScreen extends StatefulWidget {
  final Session session;

  const AdminScreen({super.key, required this.session});

  @override
  State<AdminScreen> createState() => _AdminScreenState();
}

class _AdminScreenState extends State<AdminScreen> {
  String _tab = 'users';
  Map<String, dynamic> _stats = {};
  List<dynamic> _users = [];
  List<dynamic> _channels = [];
  List<dynamic> _files = [];
  String _fileCat = 'all'; // all | photo | video | text
  bool _selecting = false;
  final Set<int> _selected = {};
  bool _registrationEnabled = true;
  Map<String, dynamic>? _ringtoneInfo;
  bool _ringtoneBusy = false;
  String? _error;
  final _newNick = TextEditingController();
  final _newPass = TextEditingController();

  ApiClient get _api => widget.session.api;

  bool _catOf(Map<String, dynamic> f, String cat) {
    final mime = (f['mime'] as String?) ?? '';
    final name = (f['filename'] as String?) ?? '';
    if (cat == 'photo') return mime.startsWith('image/');
    if (cat == 'video') return mime.startsWith('video/');
    if (cat == 'text') {
      final ext = name.toLowerCase().split('.').last;
      return {'txt','md','json','yaml','yml','log','csv','js','ts','dart','go','py','java','kt','c','cpp','h','sh','bash','html','css'}.contains(ext);
    }
    return true;
  }

  List<dynamic> get _filteredFiles {
    if (_fileCat == 'all') return _files;
    return _files.where((f) => _catOf(f as Map<String, dynamic>, _fileCat)).toList();
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _newNick.dispose();
    _newPass.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final stats = await _api.adminStats();
      final users = await _api.adminUsers();
      final channels = await _api.adminChannels();
      List<dynamic> files = [];
      try {
        files = await _api.adminListFiles();
      } catch (_) {}
      final reg = await _api.adminGetRegistration();
      Map<String, dynamic>? ringtone;
      try {
        ringtone = await _api.ringtoneInfo();
      } catch (_) {}
      if (mounted) {
        setState(() {
          _stats = stats;
          _users = users;
          _channels = channels;
          _files = files;
          _registrationEnabled = reg;
          _ringtoneInfo = ringtone;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
  }

  Future<void> _uploadRingtone() async {
    try {
      final files = await FilePicker.pickFiles(type: FileType.audio);
      if (files.isEmpty) return;
      final f = files.first;
      final bytes = await f.readAsBytes();
      if (bytes.isEmpty) {
        _snack('Не удалось прочитать файл');
        return;
      }
      if (bytes.length > 5 * 1024 * 1024) {
        _snack('Файл слишком большой (макс 5 МБ)');
        return;
      }
      setState(() => _ringtoneBusy = true);
      final mime = f.name.toLowerCase().endsWith('.mp3')
          ? 'audio/mpeg'
          : f.name.toLowerCase().endsWith('.wav')
              ? 'audio/wav'
              : 'audio/mpeg';
      await _api.uploadRingtone(Uint8List.fromList(bytes), f.name, mime);
      _snack('Мелодия обновлена — у всех заиграет новая');
      await _load();
    } catch (e) {
      _snack('Ошибка: $e');
    } finally {
      if (mounted) setState(() => _ringtoneBusy = false);
    }
  }

  Future<void> _deleteRingtone() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Сбросить мелодию?'),
        content: const Text('Будет играть стандартная (zvonok.mp3)'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Отмена')),
          FilledButton(
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDA373C)),
              onPressed: () => Navigator.pop(ctx, true),
              child: const Text('Сбросить')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      setState(() => _ringtoneBusy = true);
      await _api.deleteRingtone();
      _snack('Мелодия сброшена на дефолт');
      await _load();
    } catch (e) {
      _snack('Ошибка: $e');
    } finally {
      if (mounted) setState(() => _ringtoneBusy = false);
    }
  }

  Future<void> _deleteFile(int id) async {
    try {
      await _api.adminDeleteFile(id);
      setState(() {
        _files.removeWhere((f) => (f['id'] as num?)?.toInt() == id);
        _selected.remove(id);
      });
      _snack('Файл удалён');
    } catch (e) {
      _snack('Ошибка: $e');
    }
  }

  Future<void> _deleteSelected() async {
    if (_selected.isEmpty) return;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Удалить выбранные?'),
        content: Text('Будет удалено файлов: ${_selected.length}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Отмена')),
          FilledButton(style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDA373C)), onPressed: () => Navigator.pop(ctx, true), child: const Text('Удалить')),
        ],
      ),
    );
    if (ok != true) return;
    for (final id in _selected.toList()) {
      await _deleteFile(id);
    }
    setState(() {
      _selecting = false;
      _selected.clear();
    });
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _toggleRegistration() async {
    try {
      await _api.adminSetRegistration(!_registrationEnabled);
      setState(() => _registrationEnabled = !_registrationEnabled);
      _snack(_registrationEnabled ? 'Регистрация разрешена' : 'Регистрация запрещена');
    } catch (e) {
      _snack('Ошибка: $e');
    }
  }

  Future<void> _ban(int id, String nick, bool banned) async {
    try {
      if (banned) {
        await _api.adminServerUnban(id);
      } else {
        await _api.adminServerBan(id, 'забанен через мобильное приложение');
      }
      await _load();
    } catch (e) {
      _snack('Ошибка: $e');
    }
  }

  Future<void> _createUser() async {
    if (_newNick.text.trim().isEmpty || _newPass.text.isEmpty) {
      _snack('Укажите ник и пароль');
      return;
    }
    try {
      await _api.adminCreateUser(_newNick.text.trim(), _newPass.text);
      _newNick.clear();
      _newPass.clear();
      await _load();
      _snack('Пользователь создан');
    } catch (e) {
      _snack('Ошибка: $e');
    }
  }

  Future<void> _deleteChannel(int id, String name) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: const Color(0xFF2B2D31),
        title: const Text('Удалить канал?'),
        content: Text('Канал «$name» будет удалён вместе с сообщениями.',
            style: const TextStyle(color: Color(0xFFDBDEE1))),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Отмена', style: TextStyle(color: Color(0xFF949BA4))),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDA373C)),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Удалить'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _api.adminDeleteChannel(id);
      await _load();
      _snack('Канал удалён');
    } catch (e) {
      _snack('Ошибка: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    const text = Color(0xFFDBDEE1);
    const accent = Color(0xFF5865F2);
    const panel = Color(0xFF2B2D31);

    return Scaffold(
      backgroundColor: const Color(0xFF1E1F22),
      appBar: AppBar(
        backgroundColor: panel,
        title: const Text('Админ панель', style: TextStyle(color: text, fontSize: 18)),
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(10),
            child: Row(
              children: [
                for (final t in [('users', 'Пользователи'), ('channels', 'Каналы'), ('files', 'Файлы'), ('server', 'Сервер')])
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: _tab == t.$1 ? accent : const Color(0xFF383A40),
                          padding: const EdgeInsets.symmetric(vertical: 8),
                        ),
                        onPressed: () => setState(() => _tab = t.$1),
                        child: Text(t.$2, style: const TextStyle(color: Colors.white, fontSize: 11)),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(10),
              child: Text(_error!, style: const TextStyle(color: Color(0xFFDA373C))),
            ),
          Expanded(
            child: _tab == 'users'
                ? _usersTab()
                : _tab == 'channels'
                    ? _channelsTab()
                    : _tab == 'files'
                        ? _filesTab()
                        : _serverTab(),
          ),
        ],
      ),
    );
  }

  Widget _usersTab() {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(12),
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _newNick,
                  style: const TextStyle(color: text),
                  decoration: const InputDecoration(
                    labelText: 'Ник',
                    labelStyle: TextStyle(color: dim),
                    filled: true,
                    fillColor: Color(0xFF1E1F22),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _newPass,
                  obscureText: true,
                  style: const TextStyle(color: text),
                  decoration: const InputDecoration(
                    labelText: 'Пароль',
                    labelStyle: TextStyle(color: dim),
                    filled: true,
                    fillColor: Color(0xFF1E1F22),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: const Color(0xFF5865F2)),
                onPressed: _createUser,
                child: const Text('Создать'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.circle, size: 12, color: Color(0xFF23A55A)),
              const SizedBox(width: 6),
              Text(_registrationEnabled ? 'Регистрация разрешена' : 'Регистрация запрещена',
                  style: const TextStyle(color: dim, fontSize: 13)),
              const Spacer(),
              TextButton(
                onPressed: _toggleRegistration,
                child: Text(_registrationEnabled ? 'Запретить' : 'Разрешить',
                    style: const TextStyle(color: Color(0xFF5865F2))),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final u in _users)
            Card(
              color: const Color(0xFF2B2D31),
              child: ListTile(
                leading: Text(
                  u['nick']?.toString().characters.first.toUpperCase() ?? '?',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold),
                ),
                title: Text('${u['nick']}${(u['is_server_admin'] as bool? ?? false) ? ' 👑' : ''}',
                    style: const TextStyle(color: text)),
                subtitle: Text('ID: ${u['id']}',
                    style: TextStyle(color: dim, fontSize: 12)),
                trailing: (u['is_server_admin'] as bool? ?? false)
                    ? null
                    : TextButton(
                        onPressed: () => _ban(u['id'] as int, u['nick'] as String,
                            u['server_banned'] as bool? ?? false),
                        child: Text(
                          (u['server_banned'] as bool? ?? false) ? 'Разбанить' : 'Забанить',
                          style: TextStyle(
                            color: (u['server_banned'] as bool? ?? false)
                                ? const Color(0xFF23A55A)
                                : const Color(0xFFDA373C),
                          ),
                        ),
                      ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _channelsTab() {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(12),
        children: [
          for (final c in _channels)
            Card(
              color: const Color(0xFF2B2D31),
              child: ListTile(
                leading: Text((c['private'] as bool? ?? false) ? '🔒' : '#',
                    style: const TextStyle(fontSize: 18)),
                title: Text(c['name']?.toString() ?? '?', style: const TextStyle(color: text)),
                subtitle: Text('ID: ${c['id']} · создал: ${c['creator_nick'] ?? '?'}',
                    style: const TextStyle(color: dim, fontSize: 12)),
                trailing: IconButton(
                  icon: const Icon(Icons.delete, color: Color(0xFFDA373C)),
                  onPressed: () => _deleteChannel(c['id'] as int, c['name']?.toString() ?? '?'),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _filesTab() {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    final cats = [('all','Все'),('photo','Фото'),('video','Видео'),('text','Текст')];
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          child: Row(
            children: [
              for (final c in cats)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: _fileCat == c.$1 ? const Color(0xFF2AABEE) : const Color(0xFF383A40), padding: const EdgeInsets.symmetric(vertical: 8)),
                      onPressed: () => setState(() => _fileCat = c.$1),
                      child: Text(c.$2, style: const TextStyle(color: Colors.white, fontSize: 11)),
                    ),
                  ),
                ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            children: [
              TextButton(
                onPressed: () => setState(() {
                  _selecting = !_selecting;
                  if (!_selecting) _selected.clear();
                }),
                child: Text(_selecting ? 'Отменить' : 'Выбрать', style: const TextStyle(color: Color(0xFF2AABEE))),
              ),
              if (_selecting) ...[
                TextButton(
                  onPressed: () {
                    final all = _filteredFiles.map((f) => (f['id'] as num).toInt()).toSet();
                    setState(() => _selected.addAll(all));
                  },
                  child: const Text('Все', style: TextStyle(color: Color(0xFF949BA4))),
                ),
                const Spacer(),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: const Color(0xFFDA373C)),
                  onPressed: _selected.isEmpty ? null : _deleteSelected,
                  child: Text('Удалить (${_selected.length})', style: const TextStyle(color: Colors.white, fontSize: 12)),
                ),
              ] else
                const Spacer(),
              Text('${_filteredFiles.length} файлов', style: const TextStyle(color: dim, fontSize: 12)),
            ],
          ),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: _filteredFiles.isEmpty
                ? ListView(physics: const AlwaysScrollableScrollPhysics(), children: [Padding(padding: const EdgeInsets.all(24), child: Center(child: Text('Нет файлов', style: const TextStyle(color: dim))))])
                : GridView.builder(
                    physics: const AlwaysScrollableScrollPhysics(),
                    padding: const EdgeInsets.all(8),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, childAspectRatio: 0.85, crossAxisSpacing: 6, mainAxisSpacing: 6),
                    itemCount: _filteredFiles.length,
                    itemBuilder: (_, i) {
                      final f = _filteredFiles[i] as Map<String, dynamic>;
                      final id = (f['id'] as num).toInt();
                      final name = (f['filename'] as String?) ?? 'файл';
                      final mime = (f['mime'] as String?) ?? '';
                      final sel = _selected.contains(id);
                      return GestureDetector(
                        onTap: () {
                          if (_selecting) {
                            setState(() => sel ? _selected.remove(id) : _selected.add(id));
                          } else {
                            // превью
                            if (mime.startsWith('image/')) {
                              showDialog(context: context, builder: (ctx) => Dialog(backgroundColor: Colors.black, child: InteractiveViewer(child: Image.network(widget.session.api.fileUrl(id), errorBuilder: (_,__,___) => const Text('Ошибка', style: TextStyle(color: Colors.white))))));
                            }
                          }
                        },
                        onLongPress: () {
                          showModalBottomSheet(context: context, builder: (ctx) => SafeArea(child: Column(mainAxisSize: MainAxisSize.min, children: [
                            ListTile(leading: const Icon(Icons.delete, color: Color(0xFFDA373C)), title: const Text('Удалить файл', style: TextStyle(color: Color(0xFFDA373C))), onTap: () { Navigator.pop(ctx); _deleteFile(id); }),
                            ListTile(leading: const Icon(Icons.open_in_new), title: const Text('Открыть'), onTap: () { Navigator.pop(ctx); }),
                          ])));
                        },
                        child: Container(
                          decoration: BoxDecoration(color: sel ? const Color(0xFF2AABEE).withValues(alpha: 0.3) : const Color(0xFF2B2D31), borderRadius: BorderRadius.circular(8), border: sel ? Border.all(color: const Color(0xFF2AABEE), width: 2) : null),
                          child: Column(
                            children: [
                              Expanded(
                                child: ClipRRect(
                                  borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
                                  child: mime.startsWith('image/')
                                      ? Image.network(widget.session.api.fileUrl(id), fit: BoxFit.cover, width: double.infinity, errorBuilder: (_,__,___) => Container(color: const Color(0xFF1E1F22), child: const Icon(Icons.image, color: dim)))
                                      : Container(color: const Color(0xFF1E1F22), child: Center(child: Text(mime.startsWith('video/') ? '🎬' : '📄', style: const TextStyle(fontSize: 28)))),
                                ),
                              ),
                              Padding(padding: const EdgeInsets.all(4), child: Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: text, fontSize: 10))),
                              Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('${(f['size'] as num?) ?? 0} Б', style: const TextStyle(color: dim, fontSize: 9))),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ),
      ],
    );
  }

  Widget _serverTab() {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    final items = [
      ('Онлайн', '${_stats['online'] ?? '—'}'),
      ('Пользователей', '${_stats['users'] ?? '—'}'),
      ('Каналов', '${_stats['channels'] ?? '—'}'),
      ('Сообщений', '${_stats['messages'] ?? '—'}'),
      ('Звонков', '${_stats['calls'] ?? '—'}'),
      ('Аптайм', _fmtUptime((_stats['uptime_sec'] as num?)?.toInt() ?? 0)),
    ];
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(12),
        children: [
          if (_stats.isNotEmpty)
            GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              childAspectRatio: 3,
              children: [
                for (final (label, value) in items)
                  Card(
                    color: const Color(0xFF2B2D31),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(value, style: const TextStyle(color: text, fontSize: 18, fontWeight: FontWeight.bold)),
                        Text(label, style: const TextStyle(color: dim, fontSize: 11)),
                      ],
                    ),
                  ),
              ],
            ),
          const SizedBox(height: 8),
          Text('Go ${_stats['go'] ?? ''} · goroutines: ${_stats['goroutines'] ?? '—'}',
              style: const TextStyle(color: dim, fontSize: 12)),
          const SizedBox(height: 12),
          Card(
            color: const Color(0xFF2B2D31),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Мелодия звонка (серверная)', style: TextStyle(color: text, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  const Text('Загрузите mp3/wav/ogg/m4a до 5 МБ — будет играть у всех при входящем вызове.',
                      style: TextStyle(color: dim, fontSize: 12)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      FilledButton(
                        style: FilledButton.styleFrom(backgroundColor: const Color(0xFF2AABEE)),
                        onPressed: _ringtoneBusy ? null : _uploadRingtone,
                        child: _ringtoneBusy
                            ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Загрузить мелодию'),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton(
                        onPressed: (_ringtoneInfo?['exists'] as bool? ?? false) && !_ringtoneBusy ? _deleteRingtone : null,
                        child: const Text('Сбросить', style: TextStyle(color: Color(0xFFDA373C))),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    (_ringtoneInfo?['exists'] as bool? ?? false)
                        ? 'Текущая: ${(_ringtoneInfo?['content_type'] ?? 'audio')} · ${((_ringtoneInfo?['size'] as num?) ?? 0) ~/ 1024} КБ · ${((_ringtoneInfo?['hash'] as String?) ?? '').substring(0, 8)}'
                        : 'Сейчас: дефолт (zvonok.mp3)',
                    style: const TextStyle(color: dim, fontSize: 11),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _fmtUptime(int sec) {
    if (sec <= 0) return '—';
    final d = sec ~/ 86400;
    final h = (sec % 86400) ~/ 3600;
    final m = (sec % 3600) ~/ 60;
    if (d > 0) return '$dд $hч';
    if (h > 0) return '$hч $mм';
    return '$mм';
  }
}
