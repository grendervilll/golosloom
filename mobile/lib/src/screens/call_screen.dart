// Экран активного звонка: участники, микрофон, завершение.
library;

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' hide Session;

import '../call_service.dart';
import '../session.dart';

class CallScreen extends StatefulWidget {
  final Session session;
  final CallService calls;

  const CallScreen({super.key, required this.session, required this.calls});

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  @override
  void initState() {
    super.initState();
    widget.calls.addListener(_onChanged);
  }

  @override
  void dispose() {
    widget.calls.removeListener(_onChanged);
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _leave() async {
    await widget.calls.leave();
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    const text = Color(0xFFDBDEE1);
    const dim = Color(0xFF949BA4);
    const accent = Color(0xFF5865F2);
    const red = Color(0xFFDA373C);

    final calls = widget.calls;
    final call = calls.currentCall;
    final callId = call?.id;

    return Scaffold(
      backgroundColor: const Color(0xFF1E1F22),
      appBar: AppBar(
        backgroundColor: const Color(0xFF2B2D31),
        automaticallyImplyLeading: false,
        title: Text(callId == null ? 'Звонок' : 'Звонок #$callId',
            style: const TextStyle(color: text, fontSize: 18)),
        actions: [
          TextButton(
            onPressed: _leave,
            child: const Text('Завершить', style: TextStyle(color: red, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
      body: Column(
        children: [
          if (calls.callError != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(calls.callError!, style: const TextStyle(color: red, fontSize: 13)),
            ),
          Expanded(
            child: calls.inCall
                ? ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      for (final p in calls.remoteParticipants)
                        ListTile(
                          leading: CircleAvatar(
                            backgroundColor: const Color(0xFF383A40),
                            child: Text(
                              p.identity.isEmpty ? '?' : p.identity.split(':').last,
                              style: const TextStyle(color: text),
                            ),
                          ),
                          title: Text(p.name.isEmpty ? p.identity : p.name,
                              style: const TextStyle(color: text)),
                          trailing: _MicState(p: p),
                        ),
                      if (calls.remoteParticipants.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 60),
                          child: Center(
                            child: Text('Ждём собеседников…', style: TextStyle(color: dim)),
                          ),
                        ),
                    ],
                  )
                : const Center(child: Text('Соединение…', style: TextStyle(color: dim))),
          ),
          Container(
            color: const Color(0xFF2B2D31),
            padding: const EdgeInsets.symmetric(vertical: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _CallButton(
                  icon: calls.micEnabled ? Icons.mic : Icons.mic_off,
                  color: calls.micEnabled ? const Color(0xFF383A40) : accent,
                  onTap: calls.toggleMic,
                ),
                const SizedBox(width: 24),
                _CallButton(
                  icon: Icons.call_end,
                  color: red,
                  onTap: _leave,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MicState extends StatelessWidget {
  final RemoteParticipant p;
  const _MicState({required this.p});

  @override
  Widget build(BuildContext context) {
    final audio = p.audioTrackPublications.isNotEmpty ? p.audioTrackPublications.first : null;
    final muted = audio?.muted ?? true;
    return Icon(
      muted ? Icons.mic_off : Icons.mic,
      color: muted ? const Color(0xFF949BA4) : const Color(0xFF23A55A),
    );
  }
}

class _CallButton extends StatelessWidget {
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  const _CallButton({required this.icon, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return IconButton.filled(
      onPressed: onTap,
      icon: Icon(icon, color: Colors.white, size: 28),
      style: IconButton.styleFrom(
        backgroundColor: color,
        minimumSize: const Size(64, 64),
      ),
    );
  }
}
