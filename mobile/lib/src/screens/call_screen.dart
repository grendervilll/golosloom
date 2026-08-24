// Экран активного звонка: участники, микрофон, завершение.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart' hide Session;

import '../call_service.dart';
import '../chat_store.dart';
import '../session.dart';
import '../theme.dart';
import '../widgets/avatar.dart';
import 'call_picker.dart';
import 'chat_screen.dart';

class CallScreen extends StatefulWidget {
  final Session session;
  final CallService calls;
  final ChatStore chat;

  const CallScreen({
    super.key,
    required this.session,
    required this.calls,
    required this.chat,
  });

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
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

  Future<void> _openChat() async {
    final call = widget.calls.currentCall;
    if (call == null) return;
    final channel = widget.session.channels
        .where((c) => (c['id'] as num?)?.toInt() == call.channelId)
        .toList()
        .firstOrNull;
    if (channel == null) return;
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ChatScreen(
          session: widget.session,
          chat: widget.chat,
          calls: widget.calls,
          channel: channel,
        ),
      ),
    );
  }

  void _openFullscreen(VideoTrack track, String label) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => Scaffold(
          backgroundColor: Colors.black,
          appBar: AppBar(
            backgroundColor: Colors.black,
            title: Text(label, style: const TextStyle(color: Colors.white)),
          ),
          body: Center(child: VideoTrackRenderer(track, fit: VideoViewFit.contain)),
        ),
      ),
    );
  }

  String _fmt(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes % 60;
    final s = d.inSeconds % 60;
    String two(int v) => v.toString().padLeft(2, '0');
    return h > 0 ? '$h:${two(m)}:${two(s)}' : '$m:${two(s)}';
  }

  Room? _listenedRoom;
  int _primaryCamIdx = 0;
  bool _splitMode = false;

  /// Все камеры звонка: своя («Вы») + камеры собеседников, по порядку включения.
  List<({VideoTrack? track, String label})> _cameraTiles() {
    final out = <({VideoTrack? track, String label})>[];
    final room = widget.calls.room;
    if (room == null) return out;
    final local = room.localParticipant;
    if (local != null) {
      for (final pub in local.videoTrackPublications) {
        if (pub.source == TrackSource.camera) {
          out.add((track: pub.track, label: 'Вы'));
        }
      }
    }
    for (final p in room.remoteParticipants.values) {
      for (final pub in p.videoTrackPublications) {
        if (pub.source == TrackSource.camera) {
          out.add((track: pub.track, label: p.name.isEmpty ? p.identity : p.name));
        }
      }
    }
    if (out.isNotEmpty && _primaryCamIdx >= out.length) {
      _primaryCamIdx = out.length - 1;
    }
    return out;
  }

  int _secondaryIdx(int total) {
    if (total < 2) return -1;
    return _primaryCamIdx == 0 ? 1 : 0;
  }

  void _onChanged() {
    final room = widget.calls.room;
    if (room != null && !identical(room, _listenedRoom)) {
      _listenedRoom?.removeListener(_onRoom);
      _listenedRoom = room;
      room.addListener(_onRoom);
    }
    if (mounted) setState(() {});
  }

  void _onRoom() {
    if (mounted) setState(() {});
  }

  Future<void> _leave() async {
    await widget.calls.leave();
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _showInvite() async {
    final call = widget.calls.currentCall ?? widget.calls.ringing;
    if (call == null) return;
    final exclude = <int>{
      widget.session.settings.user?.id ?? 0,
      ...widget.calls.remoteParticipants.map((p) => int.tryParse(p.identity.split(':').first) ?? -1),
      ...call.participants,
      call.channelId, // not a user, ignore
    }..removeWhere((x) => x <= 0);
    final ids = await showCallPicker(context, widget.session, call.channelId, excludeIds: exclude);
    if (ids != null && ids.isNotEmpty) {
      await widget.calls.inviteToCall(ids);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Приглашение отправлено')));
    }
  }

  Future<void> _punch() async {
    await widget.calls.punch();
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('👊 Толчок отправлен!'), duration: Duration(seconds: 1)));
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final text = colors.text;
    final dim = colors.textDim;
    final accent = colors.accent;
    final red = colors.danger;
    final calls = widget.calls;

    return Scaffold(
      backgroundColor: colors.bg,
      appBar: AppBar(
        backgroundColor: colors.bg2,
        automaticallyImplyLeading: false,
        title: Text(
          calls.inCall ? 'Разговор · ${_fmt(calls.callDuration)}' : 'Звонок',
          style: TextStyle(color: text, fontSize: 16, fontWeight: FontWeight.w700),
        ),
        actions: [
          if (calls.inCall)
            IconButton(
              icon: const Icon(Icons.group_add),
              color: colors.textDim,
              tooltip: 'Пригласить участников',
              onPressed: _showInvite,
            ),
          _RoundIcon(
            icon: Icons.call_end,
            background: red,
            color: Colors.white,
            tooltip: 'Завершить звонок',
            onTap: _leave,
          ),
          const SizedBox(width: 6),
        ],
      ),
      body: Column(
        children: [
          if (calls.callError != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(calls.callError!, style: TextStyle(color: red, fontSize: 13)),
            ),
          Expanded(
            child: calls.inCall
                ? ListView(
                    padding: const EdgeInsets.all(12),
                    children: [
                      // Демонстрации экранов — крупно.
                      for (final p in widget.calls.remoteParticipants)
                        for (final pub in p.videoTrackPublications)
                          if (pub.source == TrackSource.screenShareVideo)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 8),
                              child: _VideoTile(
                                track: pub.track,
                                big: true,
                                label: '🖥️ ${p.name.isEmpty ? p.identity : p.name}',
                                onTap: (t) => _openFullscreen(t, '🖥️ ${p.name.isEmpty ? p.identity : p.name}'),
                              ),
                            ),
                      // Камеры: главная область + лента выбора.
                      _cameraArea(widget.calls),
                      // Участники без камеры.
                      for (final p in widget.calls.remoteParticipants)
                        if (!p.videoTrackPublications.any((x) => x.source == TrackSource.camera))
                          Padding(
                            padding: const EdgeInsets.only(top: 8),
                            child: Row(
                              children: [
                                SpeakingAvatar(
                                  session: widget.session,
                                  room: widget.calls.room!,
                                  participant: p,
                                  size: 36,
                                ),
                                const SizedBox(width: 8),
                                Text(p.name.isEmpty ? p.identity : p.name,
                                    style: TextStyle(color: text)),
                                const SizedBox(width: 8),
                                _MicState(p: p),
                              ],
                            ),
                          ),
                      if (widget.calls.remoteParticipants.isEmpty)
                        Padding(
                          padding: const EdgeInsets.only(top: 60),
                          child: Center(
                            child: Text('Ждём собеседников…', style: TextStyle(color: dim)),
                          ),
                        ),
                    ],
                  )
                : Center(child: Text('Соединение…', style: TextStyle(color: dim))),
          ),
          Container(
            color: colors.bg2,
            padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _IconToggle(
                  active: calls.micEnabled,
                  iconOn: Icons.mic,
                  iconOff: Icons.mic_off,
                  color: accent,
                  tooltip: 'Микрофон',
                  onTap: calls.toggleMic,
                ),
                const SizedBox(width: 8),
                _IconToggle(
                  active: calls.camEnabled,
                  iconOn: Icons.videocam,
                  iconOff: Icons.videocam_off,
                  color: accent,
                  tooltip: 'Веб-камера',
                  onTap: calls.toggleCam,
                ),
                const SizedBox(width: 8),
                _IconToggle(
                  active: !calls.speakersMuted,
                  iconOn: Icons.volume_up,
                  iconOff: Icons.volume_off,
                  color: colors.green,
                  tooltip: 'Звук собеседников',
                  onTap: calls.toggleSpeakers,
                ),
                const SizedBox(width: 8),
                _IconToggle(
                  active: false,
                  iconOn: Icons.person_add,
                  iconOff: Icons.person_add,
                  color: accent,
                  tooltip: 'Пригласить участников',
                  onTap: _showInvite,
                ),
                const SizedBox(width: 8),
                _IconToggle(
                  active: false,
                  iconOn: Icons.front_hand,
                  iconOff: Icons.front_hand,
                  color: colors.yellow,
                  tooltip: 'Толкнуть',
                  onTap: _punch,
                ),
                const SizedBox(width: 8),
                _IconToggle(
                  active: false,
                  iconOn: Icons.chat,
                  iconOff: Icons.chat,
                  color: colors.textDim,
                  tooltip: 'Чат',
                  onTap: _openChat,
                ),
                const SizedBox(width: 14),
                _RoundIcon(
                  icon: Icons.call_end,
                  background: red,
                  color: Colors.white,
                  tooltip: 'Завершить звонок',
                  onTap: _leave,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Главная область камер: одна — на весь экран; две — большая + маленькая
  /// внизу слева (или разделение на 2 части в режиме _splitMode).
  Widget _cameraArea(CallService calls) {
    final cams = _cameraTiles();
    if (cams.isEmpty) return const SizedBox.shrink();
    final primary = cams[_primaryCamIdx];
    final secondaryIdx = _secondaryIdx(cams.length);

    final primaryTile = _VideoTile(
      track: primary.track,
      big: true,
      label: primary.label,
      onTap: (t) => _openFullscreen(t, '📷 ${primary.label}'),
    );

    final double mainH = (MediaQuery.sizeOf(context).height * 0.38).clamp(160, 320);

    Widget main;
    if (secondaryIdx >= 0 && _splitMode) {
      final secondary = cams[secondaryIdx];
      main = SizedBox(
        height: mainH,
        child: Column(
          children: [
            Expanded(
              child: _VideoTile(
                track: secondary.track,
                big: true,
                label: secondary.label,
                onTap: (t) => _openFullscreen(t, '📷 ${secondary.label}'),
              ),
            ),
            const SizedBox(height: 4),
            Expanded(child: primaryTile),
          ],
        ),
      );
    } else {
      main = SizedBox(
        height: mainH,
        child: secondaryIdx >= 0
            ? Stack(
                children: [
                  Positioned.fill(child: primaryTile),
                  // Маленькая камера внизу слева (второй участник).
                  Positioned(
                    left: 8,
                    bottom: 8,
                    child: GestureDetector(
                      onTap: () => setState(() => _primaryCamIdx = secondaryIdx),
                      child: Container(
                        width: 110,
                        height: 74,
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.white24, width: 1.5),
                          boxShadow: const [BoxShadow(color: Colors.black45, blurRadius: 8)],
                        ),
                        clipBehavior: Clip.antiAlias,
                        child: _VideoTile(
                          track: cams[secondaryIdx].track,
                          big: false,
                          label: '',
                          onTap: (_) {},
                        ),
                      ),
                    ),
                  ),
                ],
              )
            : primaryTile,
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        main,
        if (cams.length > 1) _cameraStrip(cams, secondaryIdx),
      ],
    );
  }

  /// Лента всех камер: выбор главной + переключение режима «1 или 2 экрана».
  Widget _cameraStrip(List<({VideoTrack? track, String label})> cams, int secondaryIdx) {
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Row(
        children: [
          if (cams.length > 1)
            IconButton(
              icon: Icon(
                _splitMode ? Icons.fullscreen : Icons.view_agenda_outlined,
                size: 18,
                color: const Color(0xFF949BA4),
              ),
              tooltip: _splitMode ? 'Одна камера' : 'Две камеры (верх/низ)',
              onPressed: () => setState(() => _splitMode = !_splitMode),
            ),
          Expanded(
            child: SizedBox(
              height: 66,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: cams.length,
                separatorBuilder: (_, _) => const SizedBox(width: 6),
                itemBuilder: (ctx, i) {
                  final active = i == _primaryCamIdx;
                  return GestureDetector(
                    onTap: () => setState(() => _primaryCamIdx = i),
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: active ? const Color(0xFF5865F2) : Colors.transparent,
                          width: 2,
                        ),
                      ),
                      child: _VideoTile(
                        track: cams[i].track,
                        big: false,
                        label: cams[i].label,
                        onTap: (_) {},
                      ),
                    ),
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

/// Круглая кнопка-переключатель: иконки меняются с анимацией «поп»
/// (как в примере — микрофон/динамик), без надписей.
class _IconToggle extends StatelessWidget {
  final bool active;
  final IconData iconOn;
  final IconData iconOff;
  final Color color;
  final String tooltip;
  final VoidCallback onTap;

  const _IconToggle({
    required this.active,
    required this.iconOn,
    required this.iconOff,
    required this.color,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(
          width: 46,
          height: 46,
          decoration: const BoxDecoration(shape: BoxShape.circle, color: Color(0xFF383A40)),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 250),
            transitionBuilder: (child, anim) {
              final pop = Tween(begin: 0.0, end: 1.0)
                  .chain(CurveTween(curve: Curves.easeOutBack))
                  .animate(anim);
              final rot = Tween(begin: -0.12, end: 0.0).animate(anim);
              return Transform.rotate(angle: rot.value, child: ScaleTransition(scale: pop, child: child));
            },
            child: Icon(
              active ? iconOn : iconOff,
              key: ValueKey(active),
              size: 22,
              color: active ? color : const Color(0xFFA5A5B0),
            ),
          ),
        ),
      ),
    );
  }
}

/// Круглая кнопка-иконка (завершение звонка).
class _RoundIcon extends StatelessWidget {
  final IconData icon;
  final Color background;
  final Color color;
  final String tooltip;
  final VoidCallback onTap;

  const _RoundIcon({
    required this.icon,
    required this.background,
    required this.color,
    required this.tooltip,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(shape: BoxShape.circle, color: background),
          child: Icon(icon, color: color, size: 22),
        ),
      ),
    );
  }
}

class _VideoTile extends StatelessWidget {
  final VideoTrack? track;
  final bool big;
  final String label;
  final void Function(VideoTrack track) onTap;

  const _VideoTile({
    required this.track,
    required this.big,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final w = big ? double.infinity : 150.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        InkWell(
          onTap: track == null ? null : () => onTap(track!),
          borderRadius: BorderRadius.circular(10),
          child: Container(
          width: w,
          height: big ? 220 : 100,
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(10),
          ),
          clipBehavior: Clip.antiAlias,
          child: track == null
              ? const Center(
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF949BA4)),
                  ),
                )
              : VideoTrackRenderer(track!, fit: VideoViewFit.cover),
          ),
        ),
        const SizedBox(height: 2),
        Text(label,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Color(0xFF949BA4), fontSize: 11)),
      ],
    );
  }
}
