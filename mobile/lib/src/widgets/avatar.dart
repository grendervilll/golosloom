// Аватар пользователя: картинка с сервера или первая буква ника.
// Аватар ищется в кэше сессии (users[userId]); при ошибке загрузки —
// буква. «Говорящий» участник подсвечивается зелёным кольцом.
library;

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' hide Session;

import '../session.dart';

String avatarUrl(Session session, int userId, {String? avatarAt}) {
  final at = avatarAt ?? session.users[userId]?['avatarAt'];
  if (at == null || at.isEmpty) return '';
  final ts = Uri.encodeQueryComponent(at);
  return '${session.api.baseUrl}/api/avatars/$userId?v=$ts';
}

class AvatarWidget extends StatelessWidget {
  final Session session;
  final int userId;
  final String nick;
  final String? avatarAt;
  final double size;

  const AvatarWidget({
    super.key,
    required this.session,
    required this.userId,
    required this.nick,
    this.avatarAt,
    this.size = 36,
  });

  @override
  Widget build(BuildContext context) {
    final url = avatarUrl(session, userId, avatarAt: avatarAt);
    final letter = nick.isEmpty ? '?' : nick[0].toUpperCase();

    return ClipOval(
      child: url.isEmpty
          ? _LetterAvatar(letter: letter, size: size)
          : Image.network(
              url,
              width: size,
              height: size,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => _LetterAvatar(letter: letter, size: size),
            ),
    );
  }
}

class _LetterAvatar extends StatelessWidget {
  final String letter;
  final double size;

  const _LetterAvatar({required this.letter, required this.size});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      color: const Color(0xFF5865F2),
      alignment: Alignment.center,
      child: Text(
        letter,
        style: TextStyle(color: Colors.white, fontSize: size * 0.5, fontWeight: FontWeight.bold),
      ),
    );
  }
}

/// Аватар участника звонка с подсветкой, когда он говорит.
class SpeakingAvatar extends StatefulWidget {
  final Session session;
  final Room room;
  final RemoteParticipant participant;
  final double size;

  const SpeakingAvatar({
    super.key,
    required this.session,
    required this.room,
    required this.participant,
    this.size = 40,
  });

  @override
  State<SpeakingAvatar> createState() => _SpeakingAvatarState();
}

class _SpeakingAvatarState extends State<SpeakingAvatar> {
  CancelListenFunc? _cancel;
  bool _speaking = false;

  @override
  void initState() {
    super.initState();
    _speaking = _isSpeaking();
    _cancel = widget.room.events.on<ActiveSpeakersChangedEvent>((_) {
      if (mounted) setState(() => _speaking = _isSpeaking());
    });
  }

  @override
  void dispose() {
    _cancel?.call();
    super.dispose();
  }

  bool _isSpeaking() {
    return widget.room.activeSpeakers.any(
      (p) => p.identity == widget.participant.identity && p.audioLevel > 0.05,
    );
  }

  @override
  Widget build(BuildContext context) {
    final identity = widget.participant.identity;
    final parts = identity.split(':');
    final userId = int.tryParse(parts.first) ?? 0;
    final nick = widget.participant.name.isEmpty ? (parts.length > 1 ? parts[1] : identity) : widget.participant.name;

    return AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(
          color: _speaking ? const Color(0xFF23A55A) : Colors.transparent,
          width: 3,
        ),
        boxShadow: _speaking
            ? [BoxShadow(color: const Color(0xFF23A55A).withValues(alpha: 0.6), blurRadius: 8)]
            : null,
      ),
      child: AvatarWidget(session: widget.session, userId: userId, nick: nick, size: widget.size),
    );
  }
}
