#include "api/api_client.h"

#include <QFile>
#include <QFileInfo>
#include <QHttpMultiPart>
#include <QJsonDocument>
#include <QNetworkRequest>
#include <QUrl>

#include "util/base64.h"

namespace gl {

ApiClient::ApiClient(QObject* parent) : QObject(parent) {
  net_ = new QNetworkAccessManager(this);
}

ApiClient::~ApiClient() = default;

void ApiClient::setBaseUrl(const QString& url) {
  baseUrl_ = url;
  while (baseUrl_.endsWith('/')) baseUrl_.chop(1);
}

void ApiClient::setToken(const QString& token) {
  token_ = token;
}

QNetworkReply* ApiClient::request(const QString& method, const QString& path, const QJsonObject& body,
                                  Callback cb) {
  QNetworkRequest req(QUrl(baseUrl_ + path));
  req.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
  // HTTP/2 через некоторые VPN-туннели работает медленно — отключаем.
  req.setAttribute(QNetworkRequest::Http2AllowedAttribute, false);
  if (!token_.isEmpty()) req.setRawHeader("Authorization", ("Bearer " + token_).toUtf8());
  req.setTransferTimeout(30000);
  QNetworkReply* reply = nullptr;
  if (method == "GET") {
    reply = net_->get(req);
  } else {
    const QByteArray payload = QJsonDocument(body).toJson(QJsonDocument::Compact);
    if (method == "POST") reply = net_->post(req, payload);
    else if (method == "PATCH") reply = net_->sendCustomRequest(req, "PATCH", payload);
    else if (method == "PUT") reply = net_->put(req, payload);
    else reply = net_->deleteResource(req);
  }
  connect(reply, &QNetworkReply::finished, this, [this, reply, cb]() {
    const QByteArray data = reply->readAll();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    reply->deleteLater();
    QJsonObject obj;
    QString err;
    const QJsonDocument doc = QJsonDocument::fromJson(data);
    if (doc.isObject()) {
      obj = doc.object();
      err = obj.value("error").toString();
    } else if (doc.isArray()) {
      obj.insert("_array", doc.array());
    }
    if (status < 200 || status >= 300) {
      if (err.isEmpty()) err = QStringLiteral("Ошибка %1").arg(status);
      cb({}, err);
      return;
    }
    cb(obj, QString());
  });
  return reply;
}

void ApiClient::get(const QString& path, Callback cb) {
  request("GET", path, {}, std::move(cb));
}

void ApiClient::post(const QString& path, const QJsonObject& body, Callback cb) {
  request("POST", path, body, std::move(cb));
}

void ApiClient::patch(const QString& path, const QJsonObject& body, Callback cb) {
  request("PATCH", path, body, std::move(cb));
}

void ApiClient::put(const QString& path, const QJsonObject& body, Callback cb) {
  request("PUT", path, body, std::move(cb));
}

void ApiClient::del(const QString& path, Callback cb) {
  request("DELETE", path, {}, std::move(cb));
}

void ApiClient::login(const QString& nick, const QString& password, Callback cb) {
  post("/api/login", {{"nick", nick}, {"password", password}}, std::move(cb));
}

void ApiClient::registerUser(const QString& nick, const QString& password, Callback cb) {
  post("/api/register", {{"nick", nick}, {"password", password}}, std::move(cb));
}

void ApiClient::me(Callback cb) {
  get("/api/me", std::move(cb));
}

void ApiClient::listChannels(Callback cb) {
  get("/api/channels", std::move(cb));
}

void ApiClient::listMessages(qint64 channelId, qint64 beforeId, Callback cb) {
  QString path = "/api/channels/" + QString::number(channelId) + "/messages";
  if (beforeId > 0) path += "?before=" + QString::number(beforeId);
  get(path, std::move(cb));
}

void ApiClient::sendMessage(qint64 channelId, const QByteArray& ciphertext, const QByteArray& iv,
                            const QVector<qint64>& attIds, qint64 replyTo, Callback cb) {
  QJsonArray atts;
  for (qint64 id : attIds) atts.append(id);
  post("/api/channels/" + QString::number(channelId) + "/messages",
       {{"ciphertext", QString::fromLatin1(ciphertext.toBase64())},
        {"iv", QString::fromLatin1(iv.toBase64())},
        {"attachment_ids", atts},
        {"reply_to_id", replyTo}},
       std::move(cb));
}

void ApiClient::getChannel(qint64 channelId, Callback cb) {
  get("/api/channels/" + QString::number(channelId), std::move(cb));
}

void ApiClient::editMessage(qint64 channelId, qint64 messageId, const QByteArray& ciphertext,
                            const QByteArray& iv, Callback cb) {
  patch("/api/channels/" + QString::number(channelId) + "/messages/" + QString::number(messageId),
        {{"ciphertext", QString::fromLatin1(ciphertext.toBase64())},
         {"iv", QString::fromLatin1(iv.toBase64())}},
        std::move(cb));
}

void ApiClient::deleteMessage(qint64 channelId, qint64 messageId, Callback cb) {
  del("/api/channels/" + QString::number(channelId) + "/messages/" + QString::number(messageId), std::move(cb));
}

void ApiClient::deleteChannel(qint64 channelId, Callback cb) {
  del("/api/channels/" + QString::number(channelId), std::move(cb));
}

void ApiClient::listMembers(qint64 channelId, Callback cb) {
  get("/api/channels/" + QString::number(channelId) + "/members", std::move(cb));
}

void ApiClient::listUsers(Callback cb) {
  get("/api/users", std::move(cb));
}

void ApiClient::createInvite(qint64 channelId, qint64 userId, Callback cb) {
  post("/api/channels/" + QString::number(channelId) + "/invites", {{"user_id", userId}}, std::move(cb));
}

void ApiClient::listInvites(Callback cb) {
  get("/api/invites", std::move(cb));
}

void ApiClient::respondInvite(qint64 inviteId, bool accept, Callback cb) {
  post("/api/invites/" + QString::number(inviteId) + (accept ? "/accept" : "/decline"), {}, std::move(cb));
}

void ApiClient::createChannel(const QString& name, bool isPrivate, Callback cb) {
  post("/api/channels", {{"name", name}, {"private", isPrivate}}, std::move(cb));
}

void ApiClient::joinChannel(qint64 channelId, Callback cb) {
  post("/api/channels/" + QString::number(channelId) + "/join", {}, std::move(cb));
}

void ApiClient::uploadDeviceKey(const QString& deviceId, const QByteArray& publicKey, Callback cb) {
  post("/api/users/key", {{"device_id", deviceId}, {"public_key", QString::fromLatin1(publicKey.toBase64())}},
       std::move(cb));
}

void ApiClient::getMyWrappedKey(qint64 channelId, const QString& deviceId, Callback cb) {
  get("/api/channels/" + QString::number(channelId) + "/keys/me?device_id=" + QUrl::toPercentEncoding(deviceId),
      std::move(cb));
}

void ApiClient::uploadWrappedKey(qint64 channelId, qint64 userId, const QString& deviceId,
                                 const QByteArray& wrapped, Callback cb) {
  post("/api/channels/" + QString::number(channelId) + "/keys/wrap",
       {{"user_id", userId},
        {"device_id", deviceId},
        {"wrapped_key", QString::fromLatin1(wrapped.toBase64())}},
       std::move(cb));
}

void ApiClient::pendingKeyTargets(qint64 channelId, Callback cb) {
  get("/api/channels/" + QString::number(channelId) + "/keys/pending", std::move(cb));
}

void ApiClient::getKeyBackup(qint64 channelId, Callback cb) {
  get("/api/channels/" + QString::number(channelId) + "/keys/backup", std::move(cb));
}

void ApiClient::uploadKeyBackup(qint64 channelId, const QByteArray& wrapped, Callback cb) {
  put("/api/channels/" + QString::number(channelId) + "/keys/backup",
      {{"wrapped_key", QString::fromLatin1(wrapped.toBase64())}}, std::move(cb));
}

void ApiClient::uploadFile(qint64 channelId, const QString& filePath, Callback cb) {
  QHttpMultiPart* multi = new QHttpMultiPart(QHttpMultiPart::FormDataType);
  QFile* file = new QFile(filePath, multi);
  if (!file->open(QIODevice::ReadOnly)) {
    cb({}, "не удалось открыть файл");
    return;
  }
  QHttpPart part;
  part.setHeader(QNetworkRequest::ContentDispositionHeader,
                 "form-data; name=\"file\"; filename=\"" + QFileInfo(filePath).fileName() + "\"");
  part.setBodyDevice(file);
  multi->append(part);

  QNetworkRequest req(QUrl(baseUrl_ + "/api/channels/" + QString::number(channelId) + "/files"));
  if (!token_.isEmpty()) req.setRawHeader("Authorization", ("Bearer " + token_).toUtf8());
  QNetworkReply* reply = net_->post(req, multi);
  multi->setParent(reply);
  connect(reply, &QNetworkReply::finished, this, [reply, cb]() {
    const QByteArray data = reply->readAll();
    const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
    reply->deleteLater();
    if (status < 200 || status >= 300) {
      cb({}, QStringLiteral("Ошибка загрузки файла: %1").arg(status));
      return;
    }
    cb(QJsonDocument::fromJson(data).object(), QString());
  });
}

void ApiClient::getFileToken(Callback cb) {
  get("/api/files/token", std::move(cb));
}

// Скачивание файла: сначала файловый токен, затем GET /api/files/{id}.
void ApiClient::downloadFile(qint64 fileId, bool download, const QString& destPath, Callback cb) {
  getFileToken([this, fileId, download, destPath, cb](const QJsonObject& t, const QString& err) {
    if (!err.isEmpty()) {
      cb({}, err);
      return;
    }
    const QString token = t.value("token").toString();
    QString url = baseUrl_ + "/api/files/" + QString::number(fileId);
    url += (download ? "?download=1&" : "?") + QString("token=") + QUrl::toPercentEncoding(token);
    QNetworkRequest req{QUrl(url)};
    QNetworkAccessManager* nm = net_;
    QNetworkReply* reply = nm->get(req);
    connect(reply, &QNetworkReply::finished, this, [reply, destPath, cb]() {
      const int status = reply->attribute(QNetworkRequest::HttpStatusCodeAttribute).toInt();
      const QByteArray data = reply->readAll();
      reply->deleteLater();
      if (status < 200 || status >= 300) {
        cb({}, QStringLiteral("Ошибка скачивания файла: %1").arg(status));
        return;
      }
      if (!destPath.isEmpty()) {
        QFile out(destPath);
        if (!out.open(QIODevice::WriteOnly)) {
          cb({}, "не удалось сохранить файл");
          return;
        }
        out.write(data);
        out.close();
      }
      cb({{"size", static_cast<double>(data.size())}}, QString());
    });
  });
}

}  // namespace gl
