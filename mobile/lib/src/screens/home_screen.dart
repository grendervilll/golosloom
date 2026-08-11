// Главный экран: список каналов, вход в чат, проверка обновлений.
library;

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../api_client.dart';
import '../chat_store.dart';
import '../session.dart';
import '../settings.dart';
import '../update_dialog.dart';
import 'chat_screen.dart';

class HomeScreen extends StatefulWidget {
  final AppSettings settings;

  const HomeScreen({super.key, required this.settings});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late final ApiClient _api;
  late final Session _session;
  late final ChatStore _chat;
  String _myNick = '';

  @override
  void initState() {
    super.initState();
    _api = ApiClient(widget.settings.serverUrl ?? '')
      ..token = widget.settings.token;
    _myNick = widget.settings.user?.nick ?? '';
    _session = Session(widget.settings, _api);
    _chat = ChatStore(_session);
    _session.addListener(_onSessionChanged);
    _session.start();
    _checkUpdate();
  }

  @override
  void dispose() {
    _session.removeListener(_onSessionChanged);
    _chat.dispose();
    _session.stop();
    super.dispose();
  }

  void _onSessionChanged() {
    if (mounted) setState(() {});
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

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF1E1F22);
    const panel = Color(0xFF2B2D31);
    const accent = Color(0xFF5865F2);
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        backgroundColor: panel,
        title: const Text('Golosloom', style: TextStyle(color: text, fontSize: 18)),
        actions: [
          IconButton(
            icon: const Icon(Icons.logout, color: dim),
            tooltip: 'Выйти',
            onPressed: _logout,
          ),
        ],
      ),
      body: _session.error != null && _session.channels.isEmpty
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_session.error!, style: const TextStyle(color: Color(0xFFDA373C))),
                  const SizedBox(height: 8),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: accent),
                    onPressed: () {
                      _session.refreshChannels();
                    },
                    child: const Text('Повторить'),
                  ),
                ],
              ),
            )
          : RefreshIndicator(
              onRefresh: _session.refreshChannels,
              child: ListView.builder(
                physics: const AlwaysScrollableScrollPhysics(),
                itemCount: _session.channels.length + 1,
                itemBuilder: (ctx, i) {
                  if (i == 0) {
                    return Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
                      child: Text(
                        '$_myNick · каналов: ${_session.channels.length}',
                        style: const TextStyle(color: dim, fontSize: 12),
                      ),
                    );
                  }
                  final ch = _session.channels[i - 1];
                  final name = (ch['name'] as String?) ?? '?';
                  final isPrivate = (ch['private'] as bool?) ?? false;
                  return ListTile(
                    leading: Text(isPrivate ? '🔒' : '#', style: const TextStyle(fontSize: 20)),
                    title: Text(name, style: const TextStyle(color: text)),
                    subtitle: Text('ID: ${ch['id']}', style: const TextStyle(color: dim, fontSize: 12)),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ChatScreen(session: _session, chat: _chat, channel: ch),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
    );
  }
}
