// Окно «Вышла новая версия»: кнопка «Обновить» открывает APK в браузере,
// «Позже» прячет окно до выхода следующей версии.
library;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'updater.dart';

Future<void> showUpdateDialog(BuildContext context, Updater updater, UpdateInfo info) {
  return showDialog<void>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      backgroundColor: const Color(0xFF2B2D31),
      title: const Text('⬆️ Вышла новая версия'),
      content: Text(
        'Доступна версия ${info.version}. Обновить сейчас?',
        style: const TextStyle(color: Color(0xFFDBDEE1)),
      ),
      actions: [
        TextButton(
          onPressed: () async {
            await updater.dismiss(info.version);
            if (ctx.mounted) Navigator.of(ctx).pop();
          },
          child: const Text('Позже', style: TextStyle(color: Color(0xFF949BA4))),
        ),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: const Color(0xFF5865F2)),
          onPressed: () async {
            if (ctx.mounted) Navigator.of(ctx).pop();
            final url = info.apkUrl ?? info.releaseUrl;
            if (url.isNotEmpty) {
              await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
            }
          },
          child: const Text('Обновить'),
        ),
      ],
    ),
  );
}

/// Проверка обновления при старте: новое окно, только если вышла версия,
/// от которой пользователь ещё не отказывался.
Future<void> checkForUpdate(BuildContext context, {String? currentVersion}) async {
  if (!context.mounted) return;
  final updater = Updater();
  final info = await updater.checkLatest();
  if (info == null) return;
  if (currentVersion != null && !Updater.isNewer(info.version, currentVersion)) return;
  if (await updater.dismissedVersion() == info.version) return;
  if (!context.mounted) return;
  await showUpdateDialog(context, updater, info);
}
