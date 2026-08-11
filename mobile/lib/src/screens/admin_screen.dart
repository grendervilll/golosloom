// Админ-панель сервера: статистика, пользователи, каналы, регистрация.
library;

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
  bool _registrationEnabled = true;
  String? _error;
  final _newNick = TextEditingController();
  final _newPass = TextEditingController();

  ApiClient get _api => widget.session.api;

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
      final reg = await _api.adminGetRegistration();
      if (mounted) {
        setState(() {
          _stats = stats;
          _users = users;
          _channels = channels;
          _registrationEnabled = reg;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    }
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
                for (final t in [('users', 'Пользователи'), ('channels', 'Каналы'), ('server', 'Сервер')])
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: FilledButton(
                        style: FilledButton.styleFrom(
                          backgroundColor: _tab == t.$1 ? accent : const Color(0xFF383A40),
                          padding: const EdgeInsets.symmetric(vertical: 10),
                        ),
                        onPressed: () => setState(() => _tab = t.$1),
                        child: Text(t.$2, style: const TextStyle(color: Colors.white, fontSize: 13)),
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
          Expanded(child: _tab == 'users' ? _usersTab() : _tab == 'channels' ? _channelsTab() : _serverTab()),
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
