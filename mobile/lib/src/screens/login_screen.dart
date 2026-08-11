// Экран входа: адрес сервера (при первом запуске), вход и регистрация.
library;

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../settings.dart';

class LoginScreen extends StatefulWidget {
  final AppSettings settings;

  const LoginScreen({super.key, required this.settings});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _nickCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  final _serverCtrl = TextEditingController();
  final _inviteCtrl = TextEditingController();

  late String _serverUrl;
  bool _registerMode = false;
  bool _busy = false;
  String? _error;
  late ApiClient _api;

  @override
  void initState() {
    super.initState();
    _serverUrl = widget.settings.serverUrl ?? '';
    _serverCtrl.text = _serverUrl;
    _api = ApiClient(_serverUrl);
  }

  Future<void> _loadConfig() async {
    final url = _serverCtrl.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (url.isEmpty) {
      setState(() => _error = 'Укажите адрес сервера');
      return;
    }
    try {
      await ApiClient(url).config(); // проверка доступности
      await widget.settings.setServerUrl(url);
      _serverUrl = url;
      _api = ApiClient(url);
      setState(() => _error = null);
      return;
    } catch (e) {
      setState(() => _error = 'Не удалось подключиться к серверу: $e');
    }
  }

  Future<void> _submit() async {
    final nick = _nickCtrl.text.trim();
    final pass = _passCtrl.text;
    if (nick.isEmpty || pass.isEmpty) {
      setState(() => _error = 'Введите ник и пароль');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      String token;
      Map<String, dynamic> user;
      if (_registerMode) {
        user = await _api.register(nick, pass,
            invite: _inviteCtrl.text.trim().isEmpty ? null : _inviteCtrl.text.trim());
        token = await _api.login(nick, pass);
      } else {
        token = await _api.login(nick, pass);
        user = await _api.me();
      }
      _api.token = token;
      await widget.settings.saveAuth(token, user);
      if (mounted) {
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    const bg = Color(0xFF1E1F22);
    const cardBg = Color(0xFF2B2D31);
    const accent = Color(0xFF5865F2);
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);

    return Scaffold(
      backgroundColor: bg,
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Container(
              padding: const EdgeInsets.all(28),
              decoration: BoxDecoration(
                color: cardBg,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFF26282C)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Golosloom',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: text)),
                  const SizedBox(height: 4),
                  Text(_registerMode ? 'Регистрация' : 'Вход на сервер',
                      textAlign: TextAlign.center, style: const TextStyle(color: dim)),
                  const SizedBox(height: 20),
                  if (_serverUrl.isEmpty) ...[
                    TextField(
                      controller: _serverCtrl,
                      style: const TextStyle(color: text),
                      decoration: const InputDecoration(
                        labelText: 'Адрес сервера',
                        labelStyle: TextStyle(color: dim),
                        hintText: 'https://golosloom.example.com',
                        hintStyle: TextStyle(color: Color(0xFF6D6F78)),
                        filled: true,
                        fillColor: Color(0xFF1E1F22),
                      ),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      style: FilledButton.styleFrom(backgroundColor: accent),
                      onPressed: _loadConfig,
                      child: const Text('Подключиться'),
                    ),
                    const SizedBox(height: 16),
                  ],
                  TextField(
                    controller: _nickCtrl,
                    style: const TextStyle(color: text),
                    decoration: const InputDecoration(
                      labelText: 'Ник',
                      labelStyle: TextStyle(color: dim),
                      filled: true,
                      fillColor: Color(0xFF1E1F22),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _passCtrl,
                    obscureText: true,
                    style: const TextStyle(color: text),
                    decoration: const InputDecoration(
                      labelText: 'Пароль',
                      labelStyle: TextStyle(color: dim),
                      filled: true,
                      fillColor: Color(0xFF1E1F22),
                    ),
                  ),
                  if (_registerMode) ...[
                    const SizedBox(height: 8),
                    TextField(
                      controller: _inviteCtrl,
                      style: const TextStyle(color: text),
                      decoration: const InputDecoration(
                        labelText: 'Приглашение (если регистрация запрещена)',
                        labelStyle: TextStyle(color: dim),
                        filled: true,
                        fillColor: Color(0xFF1E1F22),
                      ),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    Text(_error!, style: const TextStyle(color: Color(0xFFDA373C))),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: accent,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                    onPressed: _busy ? null : _submit,
                    child: Text(_busy ? 'Подождите…' : (_registerMode ? 'Зарегистрироваться' : 'Войти')),
                  ),
                  TextButton(
                    onPressed: _busy
                        ? null
                        : () => setState(() {
                              _registerMode = !_registerMode;
                              _error = null;
                            }),
                    child: Text(_registerMode ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться',
                        style: const TextStyle(color: dim)),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
