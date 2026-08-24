// Плашка активного звонка внизу экрана: видна на любом экране,
// показывает длительность и аватары участников, тап — экран звонка.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../call_service.dart';
import '../chat_store.dart';
import '../session.dart';
import '../theme.dart';
import '../screens/call_screen.dart';
import 'avatar.dart';

class MiniCallBar extends StatefulWidget {
  final CallService calls;
  final Session session;
  final ChatStore chat;

  const MiniCallBar({super.key, required this.calls, required this.session, required this.chat});

  @override
  State<MiniCallBar> createState() => _MiniCallBarState();
}

class _MiniCallBarState extends State<MiniCallBar> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    widget.calls.addListener(_onChanged);
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    widget.calls.removeListener(_onChanged);
    _timer?.cancel();
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  String _fmt(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes % 60;
    final s = d.inSeconds % 60;
    String two(int v) => v.toString().padLeft(2, '0');
    return h > 0 ? '$h:${two(m)}:${two(s)}' : '$m:${two(s)}';
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final calls = widget.calls;
    if (!calls.inCall) return const SizedBox.shrink();
    final participants = calls.remoteParticipants;
    final shown = participants.take(3).toList();
    final extra = participants.length - shown.length;

    return SafeArea(
      top: false,
      child: Material(
        color: colors.bg2,
        child: InkWell(
          onTap: () {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => CallScreen(session: widget.session, calls: calls, chat: widget.chat),
              ),
            );
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              border: Border(top: BorderSide(color: colors.border)),
            ),
            child: Row(
              children: [
                Icon(Icons.call, color: colors.green, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Разговор · ${_fmt(calls.callDuration)}',
                    style: TextStyle(color: colors.text, fontSize: 13, fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (shown.isEmpty)
                  Text('ждём собеседников…',
                      style: TextStyle(color: colors.textDim, fontSize: 12))
                else
                  Row(
                    children: [
                      for (final p in shown)
                        Padding(
                          padding: const EdgeInsets.only(left: 4),
                          child: SpeakingAvatar(
                            session: widget.session,
                            room: calls.room!,
                            participant: p,
                            size: 28,
                          ),
                        ),
                      if (extra > 0)
                        Padding(
                          padding: const EdgeInsets.only(left: 6),
                          child: Text('+$extra',
                              style: TextStyle(color: colors.textDim, fontSize: 12)),
                        ),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
