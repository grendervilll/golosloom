#pragma once
#include <QByteArray>
#include <QJsonArray>
#include <QJsonObject>
#include <QString>
#include <QVector>

namespace gl {

struct User {
  qint64 id = 0;
  QString nick;
  QString avatar;
  bool isServerAdmin = false;
  bool serverBanned = false;

  static User fromJson(const QJsonObject& o);
};

struct Channel {
  qint64 id = 0;
  QString name;
  QString kind;      // "channel" | "dm" | "community"
  bool isPrivate = false;
  bool readonly = false;
  qint64 creatorId = 0;
  QString role;
  bool isMember = false;
  qint64 memberCount = 0;
  QString createdAt;

  static Channel fromJson(const QJsonObject& o);
  bool isE2E() const { return kind == "dm" || isPrivate; }
};

struct Attachment {
  qint64 id = 0;
  QString name;
  QString kind;
  QString url;
  QString localPath;  // для скачанных
};

struct Message {
  qint64 id = 0;
  qint64 channelId = 0;
  qint64 senderId = 0;
  QString senderNick;
  QByteArray ciphertext;
  QByteArray iv;
  bool plain = false;
  bool deleted = false;
  bool edited = false;
  QString createdAt;
  QVector<Attachment> attachments;
  qint64 replyTo = 0;
  // Расшифрованный текст (заполняется клиентом)
  QString text;
  bool encrypted = false;
  bool pending = false;  // оптимистичная отправка

  static Message fromJson(const QJsonObject& o);
};

struct KeyTarget {
  qint64 userId = 0;
  QString deviceId;
  QByteArray publicKey;
};

}  // namespace gl
