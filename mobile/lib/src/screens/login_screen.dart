// Экран входа: адрес сервера (при первом запуске), вход и регистрация.
library;

import 'package:flutter/material.dart';

import '../api_client.dart';
import '../settings.dart';
import '../theme.dart';

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
    final colors = AppColors.of(context);
    final text = colors.text;
    final dim = colors.textDim;
    final accent = colors.accent;

    return Scaffold(
      backgroundColor: colors.bg,
      body: Stack(
        children: [
          Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 400),
                child: Container(
                  padding: const EdgeInsets.all(28),
                  decoration: BoxDecoration(
                    color: colors.surface,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: colors.border),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text('Golosloom',
                          textAlign: TextAlign.center,
                          style: TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: text)),
                      const SizedBox(height: 4),
                      Text('Мессенджер со звонками',
                          textAlign: TextAlign.center, style: TextStyle(color: dim, fontSize: 13)),
                      const SizedBox(height: 20),
                      if (_serverUrl.isEmpty) ...[
                        TextField(
                          controller: _serverCtrl,
                          style: TextStyle(color: text),
                          decoration: InputDecoration(
                            labelText: 'Адрес сервера',
                            labelStyle: TextStyle(color: dim),
                            hintText: 'https://golosloom.example.com',
                            hintStyle: TextStyle(color: dim),
                            fillColor: colors.bubbleIn,
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
                        style: TextStyle(color: text),
                        decoration: InputDecoration(
                          labelText: 'Ник',
                          labelStyle: TextStyle(color: dim),
                          fillColor: colors.bubbleIn,
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: _passCtrl,
                        obscureText: true,
                        style: TextStyle(color: text),
                        decoration: InputDecoration(
                          labelText: 'Пароль',
                          labelStyle: TextStyle(color: dim),
                          fillColor: colors.bubbleIn,
                        ),
                      ),
                      if (_registerMode) ...[
                        const SizedBox(height: 8),
                        TextField(
                          controller: _inviteCtrl,
                          style: TextStyle(color: text),
                          decoration: InputDecoration(
                            labelText: 'Приглашение (если регистрация запрещена)',
                            labelStyle: TextStyle(color: dim),
                            fillColor: colors.bubbleIn,
                          ),
                        ),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Text(_error!, style: TextStyle(color: colors.danger)),
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
                            style: TextStyle(color: dim)),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          // Переключатель темы (светлая/тёмная, запоминается).
          Positioned(
            top: 8,
            right: 8,
            child: IconButton(
              tooltip: widget.settings.darkTheme ? 'Светлая тема' : 'Тёмная тема',
              icon: Icon(
                widget.settings.darkTheme ? Icons.light_mode : Icons.dark_mode,
                color: dim,
              ),
              onPressed: () async {
                await widget.settings.setDarkTheme(!widget.settings.darkTheme);
                if (mounted) setState(() {});
              },
            ),
          ),
        ],
      ),
    );
  }
}
