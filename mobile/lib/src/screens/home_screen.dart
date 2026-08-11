// Главный экран: каналы + чат (чат — следующий шаг, пока список каналов).
library;

import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../api_client.dart';
import '../settings.dart';
import '../update_dialog.dart';

class HomeScreen extends StatefulWidget {
  final AppSettings settings;

  const HomeScreen({super.key, required this.settings});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late ApiClient _api;
  List<dynamic> _channels = [];
  String? _error;
  String _myNick = '';

  @override
  void initState() {
    super.initState();
    _api = ApiClient(widget.settings.serverUrl ?? '')
      ..token = widget.settings.token;
    _myNick = widget.settings.user?.nick ?? '';
    _load();
    _checkUpdate();
  }

  Future<void> _load() async {
    try {
      final ch = await _api.channels();
      if (mounted) setState(() => _channels = ch);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
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
      body: _error != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_error!, style: const TextStyle(color: Color(0xFFDA373C))),
                  const SizedBox(height: 8),
                  FilledButton(
                    style: FilledButton.styleFrom(backgroundColor: accent),
                    onPressed: _load,
                    child: const Text('Повторить'),
                  ),
                ],
              ),
            )
          : ListView.builder(
              itemCount: _channels.length,
              itemBuilder: (ctx, i) {
                final ch = _channels[i] as Map<String, dynamic>;
                final name = (ch['name'] as String?) ?? '?';
                final isPrivate = (ch['private'] as bool?) ?? false;
                return ListTile(
                  leading: Text(isPrivate ? '🔒' : '#', style: const TextStyle(fontSize: 20)),
                  title: Text(name, style: const TextStyle(color: text)),
                  subtitle: Text('ID: ${ch['id']}', style: const TextStyle(color: dim, fontSize: 12)),
                  onTap: () {
                    // Чат канала — следующий шаг.
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('Канал «$name» — чат будет в следующем обновлении')),
                    );
                  },
                );
              },
            ),
      bottomNavigationBar: _channels.isEmpty
          ? null
          : Container(
              padding: const EdgeInsets.all(12),
              color: panel,
              child: Text('$_myNick · каналов: ${_channels.length}',
                  style: const TextStyle(color: dim, fontSize: 12)),
            ),
    );
  }
}
