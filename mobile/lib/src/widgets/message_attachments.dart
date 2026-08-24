// Отображение вложений — Flutter-версия web MessageItem/FileViewer/VideoPopup/TextPreview
library;

import 'dart:convert';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'package:video_player/video_player.dart';

import '../api_client.dart';
import '../chat_store.dart';
import '../theme.dart';
import '../utils/text_file.dart';

class MessageAttachments extends StatelessWidget {
  final ChatMessage m;
  final bool mine;
  final ApiClient api;

  const MessageAttachments({
    super.key,
    required this.m,
    required this.mine,
    required this.api,
  });

  Future<void> _openImage(BuildContext context, int fileId, String filename) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: const EdgeInsets.all(8),
        child: InteractiveViewer(
          maxScale: 6,
          child: Image.network(
            api.fileUrl(fileId),
            fit: BoxFit.contain,
            errorBuilder: (_, _, _) => const Center(child: Text('Не удалось загрузить фото')),
          ),
        ),
      ),
    );
  }

  Future<void> _openVideo(BuildContext context, int fileId, String filename) async {
    await showDialog<void>(
      context: context,
      builder: (ctx) => _VideoDialog(fileUrl: api.fileUrl(fileId), filename: filename),
    );
  }

  Future<void> _openTextPreview(BuildContext context, int fileId, String filename) async {
    try {
      final url = api.fileUrl(fileId);
      final res = await http.get(Uri.parse(url));
      final text = utf8.decode(res.bodyBytes, allowMalformed: true);
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => _TextPreviewDialog(filename: filename, content: text, lang: extLang(filename)),
      );
    } catch (_) {
      await _downloadFile(context, fileId);
    }
  }

  Future<void> _downloadFile(BuildContext context, int fileId) async {
    final url = api.fileUrl(fileId);
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {}
  }

  String _size(int bytes) {
    if (bytes >= 1024 * 1024) return '${(bytes / 1024 / 1024).toStringAsFixed(1)} МБ';
    if (bytes >= 1024) return '${(bytes / 1024).round()} КБ';
    return '$bytes Б';
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    if (m.attachmentDeleted) {
      return Container(
        margin: const EdgeInsets.only(bottom: 4),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        decoration: BoxDecoration(
          color: mine ? Colors.white.withValues(alpha: 0.12) : colors.bubbleOut,
          borderRadius: BorderRadius.circular(10),
        ),
        child: Text(
          'Файл был удалён администратором сервера',
          style: TextStyle(
            color: mine ? Colors.white.withValues(alpha: 0.9) : colors.textDim,
            fontStyle: FontStyle.italic,
            fontSize: 12.5,
          ),
        ),
      );
    }
    if (m.attachments.isEmpty) return const SizedBox.shrink();

    // Множественные вложения — сетка как в web (wrap gap6)
    if (m.attachments.length > 1) {
      return Wrap(
        spacing: 6,
        runSpacing: 6,
        children: [
          for (final a in m.attachments)
            _AttachmentItem(
              key: ValueKey('att-${m.id}-${a.id}'),
              att: a,
              mine: mine,
              api: api,
              onImage: () => _openImage(context, a.id, a.filename),
              onVideo: () => _openVideo(context, a.id, a.filename),
              onTextPreview: () => _openTextPreview(context, a.id, a.filename),
              onDownload: () => _downloadFile(context, a.id),
              sizeText: _size(a.size),
              compact: true,
            ),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final a in m.attachments)
          Padding(
            padding: const EdgeInsets.only(bottom: 5),
            child: _AttachmentItem(
              key: ValueKey('att-${m.id}-${a.id}'),
              att: a,
              mine: mine,
              api: api,
              onImage: () => _openImage(context, a.id, a.filename),
              onVideo: () => _openVideo(context, a.id, a.filename),
              onTextPreview: () => _openTextPreview(context, a.id, a.filename),
              onDownload: () => _downloadFile(context, a.id),
              sizeText: _size(a.size),
            ),
          ),
      ],
    );
  }
}

class _AttachmentItem extends StatelessWidget {
  final Attachment att;
  final bool mine;
  final ApiClient api;
  final VoidCallback onImage;
  final VoidCallback onVideo;
  final VoidCallback onTextPreview;
  final VoidCallback onDownload;
  final String sizeText;
  final bool compact;

  const _AttachmentItem({
    super.key,
    required this.att,
    required this.mine,
    required this.api,
    required this.onImage,
    required this.onVideo,
    required this.onTextPreview,
    required this.onDownload,
    required this.sizeText,
    this.compact = false,
  });

  @override
  Widget build(BuildContext context) {
    final mime = att.mime;

    // Текстовые файлы — превью как в web TextPreview (tap → просмотр)
    if (isTextFile(att.filename)) {
      return InkWell(
        onTap: onTextPreview,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: compact ? 140 : 240,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: mine ? Colors.white.withValues(alpha: 0.14) : AppColors.of(context).bg3,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.of(context).border),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('📄', style: TextStyle(fontSize: 22)),
              const SizedBox(width: 8),
              Flexible(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                  Text(att.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: mine ? Colors.white : AppColors.of(context).text, fontSize: 13, fontWeight: FontWeight.w600)),
                  Text(sizeText, style: TextStyle(color: mine ? Colors.white70 : AppColors.of(context).textDim, fontSize: 11)),
                ]),
              ),
              Icon(Icons.visibility, color: mine ? Colors.white : AppColors.of(context).accent, size: 18),
            ],
          ),
        ),
      );
    }

    // Фото: миниатюра 280x200 как в web (max 320)
    if (mime.startsWith('image/')) {
      return GestureDetector(
        onTap: onImage,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(10),
          child: Image.network(
            api.fileUrl(att.id),
            width: compact ? 140 : 280,
            height: compact ? 140 : 200,
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => _fileCard(context),
          ),
        ),
      );
    }

    // Видео: превью 280x160 с overlay ▶
    if (mime.startsWith('video/')) {
      return InkWell(
        onTap: onVideo,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          width: compact ? 140 : 280,
          height: compact ? 100 : 160,
          decoration: BoxDecoration(
            color: Colors.black,
            borderRadius: BorderRadius.circular(10),
            image: DecorationImage(image: NetworkImage(api.fileUrl(att.id)), fit: BoxFit.cover, opacity: 0.5),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              const Icon(Icons.play_circle_fill, color: Colors.white, size: 48),
              Positioned(
                bottom: 6,
                left: 6,
                right: 6,
                child: Text(att.filename, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontSize: 11, shadows: [Shadow(blurRadius: 4, color: Colors.black)])),
              ),
            ],
          ),
        ),
      );
    }

    // Голосовое: кнопка воспроизведения.
    if (mime.startsWith('audio/')) {
      return _AudioAttachment(att: att, mine: mine, api: api);
    }

    // Остальное: карточка файла со скачиванием.
    return _fileCard(context);
  }

  Widget _fileCard(BuildContext context) {
    final colors = AppColors.of(context);
    return Container(
      constraints: const BoxConstraints(maxWidth: 230),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: mine ? Colors.white.withValues(alpha: 0.12) : colors.bubbleOut,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('📎', style: TextStyle(fontSize: 20)),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  att.filename,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: mine ? Colors.white : colors.text,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  sizeText,
                  style: TextStyle(
                    color: mine ? Colors.white.withValues(alpha: 0.75) : colors.textDim,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.download,
                color: mine ? Colors.white : colors.accent, size: 18),
            onPressed: onDownload,
          ),
        ],
      ),
    );
  }
}

class _TextPreviewDialog extends StatelessWidget {
  final String filename;
  final String content;
  final String lang;
  const _TextPreviewDialog({required this.filename, required this.content, required this.lang});

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    return Dialog(
      backgroundColor: const Color(0xFF161B22),
      insetPadding: const EdgeInsets.all(12),
      child: Container(
        width: double.infinity,
        height: MediaQuery.of(context).size.height * 0.7,
        decoration: BoxDecoration(color: const Color(0xFF161B22), borderRadius: BorderRadius.circular(12)),
        child: Column(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.05), borderRadius: const BorderRadius.vertical(top: Radius.circular(12))),
              child: Row(
                children: [
                  Expanded(child: Text(filename, style: const TextStyle(color: Colors.white, fontSize: 13, fontWeight: FontWeight.w600), overflow: TextOverflow.ellipsis)),
                  Container(padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2), decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(999)), child: Text(lang, style: const TextStyle(color: Color(0xFF8B949E), fontSize: 11))),
                  const SizedBox(width: 8),
                  IconButton(icon: const Icon(Icons.close, color: Colors.white70, size: 20), onPressed: () => Navigator.pop(context)),
                ],
              ),
            ),
            Expanded(child: SingleChildScrollView(padding: const EdgeInsets.all(12), child: SelectableText(content, style: const TextStyle(fontFamily: 'monospace', fontSize: 12.5, height: 1.5, color: Color(0xFFE6EDF3))))),
          ],
        ),
      ),
    );
  }
}

/// Голосовое вложение: тап — играть/пауза (audioplayers).
class _AudioAttachment extends StatefulWidget {
  final Attachment att;
  final bool mine;
  final ApiClient api;

  const _AudioAttachment({required this.att, required this.mine, required this.api});

  @override
  State<_AudioAttachment> createState() => _AudioAttachmentState();
}

class _AudioAttachmentState extends State<_AudioAttachment> {
  final AudioPlayer _player = AudioPlayer();
  bool _playing = false;

  @override
  void initState() {
    super.initState();
    _player.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _playing = false);
    });
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_playing) {
      await _player.stop();
      if (mounted) setState(() => _playing = false);
    } else {
      await _player.play(UrlSource(widget.api.fileUrl(widget.att.id)));
      if (mounted) setState(() => _playing = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = AppColors.of(context);
    final mine = widget.mine;
    return InkWell(
      onTap: _toggle,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        constraints: const BoxConstraints(maxWidth: 230),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        decoration: BoxDecoration(
          color: mine ? Colors.white.withValues(alpha: 0.12) : colors.bubbleOut,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              _playing ? Icons.pause_circle : Icons.play_circle,
              color: mine ? Colors.white : colors.accent,
              size: 28,
            ),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                _playing ? 'Воспроизведение…' : widget.att.filename,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  color: mine ? Colors.white : colors.text,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Полноэкранный видеоплеер (video_player).
class _VideoDialog extends StatefulWidget {
  final String fileUrl;
  final String filename;

  const _VideoDialog({required this.fileUrl, required this.filename});

  @override
  State<_VideoDialog> createState() => _VideoDialogState();
}

class _VideoDialogState extends State<_VideoDialog> {
  VideoPlayerController? _controller;

  @override
  void initState() {
    super.initState();
    final c = VideoPlayerController.networkUrl(Uri.parse(widget.fileUrl));
    _controller = c;
    c.initialize().then((_) {
      if (mounted) {
        setState(() {});
        c.play();
      }
    }).catchError((_) {});
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = _controller;
    return Dialog(
      backgroundColor: Colors.black,
      insetPadding: const EdgeInsets.all(8),
      child: c != null && c.value.isInitialized
          ? Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Stack(
                  children: [
                    AspectRatio(
                      aspectRatio: c.value.aspectRatio,
                      child: VideoPlayer(c),
                    ),
                    Positioned(
                      top: 4,
                      right: 4,
                      child: IconButton(
                        icon: const Icon(Icons.close, color: Colors.white),
                        onPressed: () => Navigator.of(context).pop(),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    IconButton(
                      icon: Icon(
                        c.value.isPlaying ? Icons.pause : Icons.play_arrow,
                        color: Colors.white,
                      ),
                      onPressed: () {
                        c.value.isPlaying ? c.pause() : c.play();
                        setState(() {});
                      },
                    ),
                  ],
                ),
              ],
            )
          : const Padding(
              padding: EdgeInsets.all(40),
              child: CircularProgressIndicator(),
            ),
    );
  }
}
