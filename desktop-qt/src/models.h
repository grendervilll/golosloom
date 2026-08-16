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
  bool isPrivate = false;
  qint64 creatorId = 0;
  QString role;
  bool isMember = false;
  QString createdAt;

  static Channel fromJson(const QJsonObject& o);
};

struct Message {
  qint64 id = 0;
  qint64 channelId = 0;
  qint64 senderId = 0;
  QString senderNick;
  QByteArray ciphertext;
  QByteArray iv;
  bool deleted = false;
  bool edited = false;
  QString createdAt;
  qint64 replyTo = 0;
  // Вложения (файлы): id, filename, mime, size.
  struct Attachment {
    qint64 id = 0;
    QString filename;
    QString mime;
    qint64 size = 0;
  };
  QVector<Attachment> attachments;
  // Расшифрованный текст (заполняется клиентом)
  QString text;
  bool encrypted = false;
  bool pending = false;  // оптимистичная отправка

  static Message fromJson(const QJsonObject& o);
};

struct ChannelMember {
  qint64 userId = 0;
  QString nick;
  QString role;
  bool isServerAdmin = false;
  bool online = false;

  static ChannelMember fromJson(const QJsonObject& o);
};

struct Invite {
  qint64 id = 0;
  qint64 channelId = 0;
  QString channelName;
  qint64 invitedBy = 0;
  QString invitedByNick;
  QString createdAt;

  static Invite fromJson(const QJsonObject& o);
};

struct KeyTarget {
  qint64 userId = 0;
  QString deviceId;
  QByteArray publicKey;
};

}  // namespace gl
