#include "call/livekit_client.h"

#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimer>
#include <QUrl>
#include <QUrlQuery>

#include <gst/sdp/gstsdpmessage.h>
#include <gst/webrtc/webrtc.h>

#include "call/proto.h"
#include "util/base64.h"

namespace gl {

namespace {

constexpr int kSignalRequestOffer = 1;
constexpr int kSignalRequestAnswer = 2;
constexpr int kSignalRequestTrickle = 3;
constexpr int kSignalRequestAddTrack = 4;
constexpr int kSignalRequestUpdateSub = 6;
constexpr int kSignalRequestLeave = 8;

constexpr int kSignalResponseJoin = 1;
constexpr int kSignalResponseAnswer = 2;
constexpr int kSignalResponseOffer = 3;
constexpr int kSignalResponseTrickle = 4;
constexpr int kSignalResponseTrackPublished = 6;

QByteArray encodeSessionDescription(const QString& type, const QString& sdp) {
  QByteArray m;
  m += Pb::str(1, type);
  m += Pb::str(2, sdp);
  return m;
}

QByteArray encodeTrickle(const QString& candidate, int target, bool final) {
  // TrickleRequest.candidateInit — JSON-строка RTCIceCandidateInit,
  // а не сырой SDP-кандидат: {"candidate":"candidate:...","sdpMid":"0","sdpMLineIndex":0}.
  const QString json = QStringLiteral("{\"candidate\":\"%1\",\"sdpMid\":\"0\",\"sdpMLineIndex\":0}")
                           .arg(QString(candidate).replace('\\', "\\\\").replace('"', "\\\""));
  QByteArray m;
  m += Pb::str(1, json);
  m += Pb::var(2, static_cast<quint64>(target));
  m += Pb::boolean(3, final);
  return m;
}

// Извлечение a=mid из SDP (первая m= секция).
QString extractMid(const QString& sdp) {
  const QStringList lines = sdp.split('\n');
  for (const QString& line : lines) {
    if (line.startsWith("a=mid:")) return line.mid(6).trimmed();
  }
  return {};
}

}  // namespace

LiveKitClient::LiveKitClient(QObject* parent) : QObject(parent) {
  connect(&ws_, &QWebSocket::connected, this, &LiveKitClient::onWsConnected);
  connect(&ws_, &QWebSocket::textMessageReceived, this, &LiveKitClient::onWsMessage);
  connect(&ws_, &QWebSocket::binaryMessageReceived, this,
          [this](const QByteArray& data) { handleResponse(data); });
  connect(&ws_, &QWebSocket::disconnected, this, &LiveKitClient::onWsDisconnected);
  connect(&ws_, &QWebSocket::errorOccurred, this,
          [this](QAbstractSocket::SocketError) { qWarning() << "LK WS error:" << ws_.errorString(); });
}

void LiveKitClient::connectRoom(const QString& wsUrl, const QString& token, bool publishAudio,
                                bool publishVideo) {
  roomUrl_ = wsUrl;
  token_ = token;
  publishAudio_ = publishAudio;
  publishVideo_ = publishVideo;
  offerSent_ = false;
  connected_ = false;
  publisherAnswered_ = false;
  subscriberOfferReceived_ = false;
  started_ = false;
  // Старый сигнальный путь /rtc (v0): НЕ требует join_request, поэтому
  // LiveKit НЕ включает single Peer Connection — publisher и subscriber
  // идут раздельными транспортами, subscriber offer приходит на поле 3.
  // (join_request в URL в v1.13.5 принудительно включает single-PC.)
  QString base = wsUrl;
  while (base.endsWith('/')) base.chop(1);
  QUrl url(base + "/rtc");
  QUrlQuery q;
  q.addQueryItem("access_token", token);
  q.addQueryItem("protocol", "2");
  q.addQueryItem("sdk", "cpp");
  q.addQueryItem("version", "0.1.0");
  q.addQueryItem("auto_subscribe", "true");
  url.setQuery(q);
  QFile f("/tmp/lk-token.txt");
  if (f.open(QIODevice::WriteOnly | QIODevice::Truncate)) {
    f.write(token.toUtf8());
  }
  qInfo() << "LK URL:" << url.toString(QUrl::RemoveQuery).toUtf8().constData();
  ws_.open(url);
}

void LiveKitClient::disconnectRoom() {
  QByteArray leave = Pb::msg(kSignalRequestLeave, QByteArray());
  sendSignalRequest(leave);
  ws_.close();
  if (pubBin_) {
    gst_element_set_state(pubBin_, GST_STATE_NULL);
    gst_object_unref(pubBin_);
  }
  if (subBin_) {
    gst_element_set_state(subBin_, GST_STATE_NULL);
    gst_object_unref(subBin_);
  }
  pub_ = nullptr;
  sub_ = nullptr;
  pubBin_ = nullptr;
  subBin_ = nullptr;
  connected_ = false;
  emit connectedChanged(false);
}

void LiveKitClient::setMicEnabled(bool on) {
  micOn_ = on;
  if (pubAudioSrc_) {
    GstElement* vol = gst_bin_get_by_name(GST_BIN(pub_), "vol");
    if (vol) {
      g_object_set(vol, "mute", !on, nullptr);
      gst_object_unref(vol);
    }
  }
}

void LiveKitClient::setCamEnabled(bool on) {
  camOn_ = on;
  if (pubVideoSrc_) gst_element_set_state(pubVideoSrc_, on ? GST_STATE_PLAYING : GST_STATE_PAUSED);
}

void LiveKitClient::onWsConnected() {
}

void LiveKitClient::onWsMessage(const QString& msg) {
  handleResponse(b64Decode(msg));
}

void LiveKitClient::onWsDisconnected() {
  connected_ = false;
  emit connectedChanged(false);
}

void LiveKitClient::sendSignalRequest(const QByteArray& proto) {
  ws_.sendBinaryMessage(proto);
}

void LiveKitClient::handleResponse(const QByteArray& data) {
  Pb::Reader r(data);
  while (r.next()) {
    const int f = r.field();
    if (f == kSignalResponseJoin) {
      const QByteArray joinBytes = r.asBytes();
      Pb::Reader jr(joinBytes);
      while (jr.next()) {
        if (jr.field() == 6) qInfo() << "LK join: subscriber_primary = true";
        if (jr.field() == 15) qInfo() << "LK join: fast_publish = true";
      }
      connected_ = true;
      emit connectedChanged(true);
      startPublish();
    } else if (f == kSignalResponseAnswer) {
      handleSdpAnswer(r.asBytes());
    } else if (f == kSignalResponseOffer) {
      handleOffer(r.asBytes());
    } else if (f == kSignalResponseTrickle) {
      handleTrickle(r.asBytes());
    } else if (f == kSignalResponseTrackPublished) {
      handleTrackPublished(r.asBytes());
    } else if (f == 5) {
      // ParticipantUpdate: новые участники с их треками — подписываемся.
      handleParticipantUpdate(r.asBytes());
    }
  }
}

void LiveKitClient::handleParticipantUpdate(const QByteArray& data) {
  // ParticipantUpdate { participants=1 (repeated ParticipantInfo) }
  // ParticipantInfo { sid=1, identity=2, state=3, tracks=4 (repeated TrackInfo) }
  // TrackInfo { sid=1 }
  Pb::Reader r(data);
  QStringList sids;
  while (r.next()) {
    if (r.field() != 1) continue;
    const QByteArray piBytes = r.asBytes();  // копия — вложенный Reader живёт дольше
    Pb::Reader p(piBytes);
    while (p.next()) {
      if (p.field() == 4) {
        const QByteArray trBytes = p.asBytes();
        Pb::Reader tr(trBytes);
        while (tr.next()) {
          if (tr.field() == 1) sids << tr.asString();
        }
      }
    }
  }
  if (sids.isEmpty()) return;
  // Подписка на треки: UpdateSubscription { track_sids=1, subscribe=2 }.
  QByteArray sub;
  for (const QString& sid : sids) sub += Pb::str(1, sid);
  sub += Pb::boolean(2, true);
  sendSignalRequest(Pb::msg(kSignalRequestUpdateSub, sub));
}

void LiveKitClient::handleTrackPublished(const QByteArray& data) {
  // TrackPublishedResponse { cid=1, track=2 }
  Pb::Reader r(data);
  QString cid;
  while (r.next()) {
    if (r.field() == 1) {
      cid = r.asString();
    } else if (r.field() == 2) {
      // TrackInfo { sid=1 }
      const QByteArray tiBytes = r.asBytes();  // копия для вложенного Reader
      Pb::Reader tr(tiBytes);
      while (tr.next()) {
        if (tr.field() == 1) {
          publisherTrackSid_ = tr.asString();
          break;
        }
      }
    }
  }
  if (!publisherTrackCid_.isEmpty() && cid == publisherTrackCid_ && !publisherTrackSid_.isEmpty()) {
    // Ждём, когда webrtcbin создаст offer (on-negotiation-needed уже в пути).
  }
}

void LiveKitClient::handleTrickle(const QByteArray& trickle) {
  Pb::Reader r(trickle);
  QString candidateJson;
  int target = 0;
  while (r.next()) {
    if (r.field() == 1) {
      candidateJson = r.asString();
    } else if (r.field() == 2) {
      target = static_cast<int>(r.asVarint());
    }
  }
  if (candidateJson.isEmpty()) return;
  // candidateInit — JSON RTCIceCandidateInit: {"candidate":"...","sdpMid":...}.
  QString candidate = candidateJson;
  const QJsonObject obj = QJsonDocument::fromJson(candidateJson.toUtf8()).object();
  if (obj.contains("candidate")) candidate = obj.value("candidate").toString();
  if (candidate.isEmpty()) return;
  GstElement* pc = target == 0 ? pub_ : sub_;
  guint mlineindex = 0;
  if (obj.contains("sdpMLineIndex")) mlineindex = static_cast<guint>(obj.value("sdpMLineIndex").toInt());
  if (!pc) {
    // webrtcbin ещё не создан — откладываем кандидата.
    PendingTrickle t;
    t.target = target;
    t.mlineindex = mlineindex;
    t.candidate = candidate;
    pendingTrickles_.append(t);
    return;
  }
  g_signal_emit_by_name(pc, "add-ice-candidate", mlineindex, candidate.toUtf8().constData());
}

void LiveKitClient::flushPendingTrickles() {
  for (const PendingTrickle& t : pendingTrickles_) {
    GstElement* pc = t.target == 0 ? pub_ : sub_;
    if (!pc) continue;
    g_signal_emit_by_name(pc, "add-ice-candidate", t.mlineindex, t.candidate.toUtf8().constData());
  }
  pendingTrickles_.clear();
}

void LiveKitClient::handleOffer(const QByteArray& sdpBytes) {
  // Subscriber offer: SessionDescription { type=1, sdp=2 }
  Pb::Reader r(sdpBytes);
  QString sdp;
  while (r.next()) {
    if (r.field() == 2) sdp = r.asString();
  }
  if (sdp.isEmpty()) return;
  subscriberOfferReceived_ = true;
  emit subscriberOfferSignal();
  if (!sub_) initSubscriberPipeline();

  GstSDPMessage* sdpMsg = nullptr;
  if (gst_sdp_message_new(&sdpMsg) != GST_SDP_OK) return;
  if (gst_sdp_message_parse_buffer(reinterpret_cast<const guint8*>(sdp.toUtf8().constData()), sdp.toUtf8().size(),
                                   sdpMsg) != GST_SDP_OK) {
    gst_sdp_message_free(sdpMsg);
    return;
  }
  GstWebRTCSessionDescription* desc =
      gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_OFFER, sdpMsg);
  g_signal_emit_by_name(sub_, "set-remote-description", desc, nullptr);
  gst_webrtc_session_description_free(desc);

  // create-answer в 1.28: (GstStructure* options, GstPromise*) — через promise.
  GstPromise* promise = gst_promise_new_with_change_func(
      [](GstPromise* p, gpointer data) {
        auto* client = static_cast<LiveKitClient*>(data);
        const GstStructure* reply = gst_promise_get_reply(p);
        if (!reply) return;
        GstWebRTCSessionDescription* answer = nullptr;
        gst_structure_get(reply, "answer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &answer, nullptr);
        if (!answer) return;
        g_signal_emit_by_name(client->sub_, "set-local-description", answer, nullptr);
        client->sendAnswer(answer);
        gst_webrtc_session_description_free(answer);
      },
      this, nullptr);
  g_signal_emit_by_name(sub_, "create-answer", nullptr, promise);
  gst_promise_unref(promise);
}

void LiveKitClient::handleSdpAnswer(const QByteArray& sdpBytes) {
  Pb::Reader r(sdpBytes);
  QString sdp;
  while (r.next()) {
    if (r.field() == 2) sdp = r.asString();
  }
  if (!sdp.isEmpty()) {
    publisherAnswered_ = true;
    publisherSdp_ = sdp;
      emit publisherAnsweredSignal();
  }
  if (sdp.isEmpty() || !pub_) return;
  // LiveKit (ICE-lite) отвечает m=audio 0 (порт 0 = «rejected» для GStreamer)
  // и шлёт кандидатов trickle'ом. Заменяем порт 0 на ненулевой, иначе
  // GStreamer отвергнет m-line и не запустит DTLS.
  const QStringList lines = sdp.split('\n');
  QStringList patched;
  patched.reserve(lines.size());
  for (const QString& line : lines) {
    if (line.startsWith("m=audio 0 ")) {
      patched.append("m=audio 9 " + line.mid(10));
    } else {
      patched.append(line);
    }
  }
  sdp = patched.join('\n');
  GstSDPMessage* sdpMsg = nullptr;
  if (gst_sdp_message_new(&sdpMsg) != GST_SDP_OK) return;
  if (gst_sdp_message_parse_buffer(reinterpret_cast<const guint8*>(sdp.toUtf8().constData()), sdp.toUtf8().size(),
                                   sdpMsg) != GST_SDP_OK) {
    gst_sdp_message_free(sdpMsg);
    return;
  }
  GstWebRTCSessionDescription* desc =
      gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_ANSWER, sdpMsg);
  g_signal_emit_by_name(pub_, "set-remote-description", desc, nullptr);
  gst_webrtc_session_description_free(desc);
}

// ---------- GStreamer ----------

void onPubNegotiationNeeded(GstElement* webrtc, gpointer user_data) {
  auto* client = static_cast<LiveKitClient*>(user_data);
  client->createPublisherOffer();
}

void onPubIce(GstElement* webrtc, guint mlineindex, gchar* candidate, gpointer user_data) {
  auto* client = static_cast<LiveKitClient*>(user_data);
  QByteArray msg = Pb::msg(kSignalRequestTrickle, encodeTrickle(QString::fromUtf8(candidate), 0, false));
  client->sendSignalRequest(msg);
}

void onConnStateNotify(GObject* obj, GParamSpec*, gpointer) {
  GstWebRTCPeerConnectionState st = GST_WEBRTC_PEER_CONNECTION_STATE_NEW;
  g_object_get(obj, "connection-state", &st, nullptr);
  qInfo() << "LK PC state:" << static_cast<int>(st);
}

void onSubIce(GstElement* webrtc, guint mlineindex, gchar* candidate, gpointer user_data) {
  auto* client = static_cast<LiveKitClient*>(user_data);
  QByteArray msg = Pb::msg(kSignalRequestTrickle, encodeTrickle(QString::fromUtf8(candidate), 1, false));
  client->sendSignalRequest(msg);
}

static void onPubPadAdded(GstElement* element, GstPad* pad, gpointer user_data) {
  // Publisher: не ожидаем входящих потоков.
  Q_UNUSED(element);
  Q_UNUSED(pad);
  Q_UNUSED(user_data);
}

static void onSubPadAdded(GstElement* element, GstPad* pad, gpointer user_data) {
  auto* client = static_cast<LiveKitClient*>(user_data);
  GstCaps* caps = gst_pad_get_current_caps(pad);
  const GstStructure* s = caps ? gst_caps_get_structure(caps, 0) : nullptr;
  const gchar* media = s ? gst_structure_get_name(s) : nullptr;
  gst_caps_unref(caps);

  if (media && g_str_has_prefix(media, "application/x-rtp")) {
    // Определяем аудио/видео по кодировке в SDP caps.
    const gchar* encoding = s ? gst_structure_get_string(s, "encoding-name") : nullptr;
    const bool audio = encoding && (g_ascii_strcasecmp(encoding, "OPUS") == 0 ||
                                    g_ascii_strcasecmp(encoding, "PCMU") == 0 ||
                                    g_ascii_strcasecmp(encoding, "PCMA") == 0);
    GstPad* sinkpad = nullptr;
    if (audio) {
      GstElement* depay = gst_element_factory_make("rtpopusdepay", nullptr);
      GstElement* dec = gst_element_factory_make("opusdec", nullptr);
      GstElement* conv = gst_element_factory_make("audioconvert", nullptr);
      GstElement* sink = gst_element_factory_make("autoaudiosink", nullptr);
      if (depay && dec && conv && sink) {
        gst_bin_add_many(GST_BIN(element), depay, dec, conv, sink, nullptr);
        gst_element_link_many(depay, dec, conv, sink, nullptr);
        sinkpad = gst_element_get_static_pad(depay, "sink");
        gst_element_sync_state_with_parent(depay);
        gst_element_sync_state_with_parent(dec);
        gst_element_sync_state_with_parent(conv);
        gst_element_sync_state_with_parent(sink);
      }
    } else {
      GstElement* depay = gst_element_factory_make("rtpvp8depay", nullptr);
      GstElement* dec = gst_element_factory_make("vp8dec", nullptr);
      GstElement* conv = gst_element_factory_make("videoconvert", nullptr);
      GstElement* sink = gst_element_factory_make("autovideosink", nullptr);
      if (depay && dec && conv && sink) {
        gst_bin_add_many(GST_BIN(element), depay, dec, conv, sink, nullptr);
        gst_element_link_many(depay, dec, conv, sink, nullptr);
        sinkpad = gst_element_get_static_pad(depay, "sink");
        gst_element_sync_state_with_parent(depay);
        gst_element_sync_state_with_parent(dec);
        gst_element_sync_state_with_parent(conv);
        gst_element_sync_state_with_parent(sink);
      }
    }
    if (sinkpad) {
      gst_pad_link(pad, sinkpad);
      gst_object_unref(sinkpad);
    }
  }
}

void LiveKitClient::initPublisherPipeline() {
  const char* audioSrc = fakeAudio_ ? "audiotestsrc" : "autoaudiosrc";
  const QString pipeline = QString(
      "webrtcbin name=pub "
      "%1 ! audioconvert ! audioresample ! "
      "opusenc ! rtpopuspay ! application/x-rtp,media=audio,encoding-name=OPUS,payload=111 ! pub.")
                              .arg(audioSrc);
  GstElement* bin = gst_parse_launch(pipeline.toUtf8().constData(), nullptr);
  if (!bin) return;
  // gst_parse_launch возвращает pipeline; webrtcbin — по имени.
  GstElement* webrtc = gst_bin_get_by_name(GST_BIN(bin), "pub");
  if (!webrtc) {
    gst_object_unref(bin);
    return;
  }
  pub_ = webrtc;
  pubBin_ = bin;
  g_signal_connect(webrtc, "on-ice-candidate", G_CALLBACK(onPubIce), this);
  g_signal_connect(webrtc, "pad-added", G_CALLBACK(onPubPadAdded), this);
  g_signal_connect(webrtc, "on-negotiation-needed", G_CALLBACK(onPubNegotiationNeeded), this);
  g_signal_connect(webrtc, "notify::connection-state", G_CALLBACK(onConnStateNotify), this);
  gst_element_set_state(bin, GST_STATE_PLAYING);
  flushPendingTrickles();
}

void LiveKitClient::initSubscriberPipeline() {
  GstElement* bin = gst_parse_launch("webrtcbin name=sub", nullptr);
  if (!bin) return;
  GstElement* webrtc = gst_bin_get_by_name(GST_BIN(bin), "sub");
  if (!webrtc) {
    gst_object_unref(bin);
    return;
  }
  sub_ = webrtc;
  subBin_ = bin;
  g_signal_connect(webrtc, "on-ice-candidate", G_CALLBACK(onSubIce), this);
  g_signal_connect(webrtc, "pad-added", G_CALLBACK(onSubPadAdded), this);
  g_signal_connect(webrtc, "notify::connection-state", G_CALLBACK(onConnStateNotify), this);
  gst_element_set_state(bin, GST_STATE_PLAYING);
  flushPendingTrickles();
}

void LiveKitClient::startPublish() {
  if (started_) return;
  if (!publishAudio_ && !publishVideo_) return;
  started_ = true;
  if (!pub_) initPublisherPipeline();
  if (!pub_) return;

  // Добавляем дорожку: AddTrackRequest { cid, name, type, source }
  publisherTrackCid_ = "TR_" + QString::number(reinterpret_cast<quintptr>(this) % 100000);
  QByteArray add;
  add += Pb::str(1, publisherTrackCid_);
  add += Pb::str(2, "microphone");
  add += Pb::var(3, 0);  // TrackType.AUDIO
  add += Pb::var(8, 2);  // TrackSource.MICROPHONE
  QByteArray msg = Pb::msg(kSignalRequestAddTrack, add);
  sendSignalRequest(msg);

  // Offer создаём после add_track (если webrtcbin не запустил переговоры сам).
  QTimer::singleShot(400, this, [this]() { createPublisherOffer(); });
}

void LiveKitClient::createPublisherOffer() {
  if (!pub_ || offerSent_) return;
  GstPromise* promise = gst_promise_new_with_change_func(
      [](GstPromise* p, gpointer data) {
        auto* client = static_cast<LiveKitClient*>(data);
        const GstStructure* reply = gst_promise_get_reply(p);
        if (!reply) return;
        GstWebRTCSessionDescription* offer = nullptr;
        gst_structure_get(reply, "offer", GST_TYPE_WEBRTC_SESSION_DESCRIPTION, &offer, nullptr);
        if (!offer) return;
        // LiveKit-клиенты инициируют DTLS (setup:active). GStreamer ставит
        // actpass — переписываем локальное описание на active, чтобы роль
        // DTLS определилась корректно (мы — client).
        gchar* sdpText = gst_sdp_message_as_text(offer->sdp);
        QString sdpStr = QString::fromUtf8(sdpText);
        g_free(sdpText);
        sdpStr.replace(QStringLiteral("a=setup:actpass"), QStringLiteral("a=setup:active"));

        GstSDPMessage* mod = nullptr;
        if (gst_sdp_message_new(&mod) == GST_SDP_OK &&
            gst_sdp_message_parse_buffer(reinterpret_cast<const guint8*>(sdpStr.toUtf8().constData()),
                                         sdpStr.toUtf8().size(), mod) == GST_SDP_OK) {
          GstWebRTCSessionDescription* local =
              gst_webrtc_session_description_new(GST_WEBRTC_SDP_TYPE_OFFER, mod);
          g_signal_emit_by_name(client->pub_, "set-local-description", local, nullptr);
          client->sendPublisherOffer(local);
          gst_webrtc_session_description_free(local);
        } else {
          if (mod) gst_sdp_message_free(mod);
          g_signal_emit_by_name(client->pub_, "set-local-description", offer, nullptr);
          client->sendPublisherOffer(offer);
        }
        client->offerSent_ = true;
        gst_webrtc_session_description_free(offer);
      },
      this, nullptr);
  g_signal_emit_by_name(pub_, "create-offer", nullptr, promise);
  gst_promise_unref(promise);
}

void LiveKitClient::sendPublisherOffer(const GstWebRTCSessionDescription* desc) {
  gchar* sdp = gst_sdp_message_as_text(desc->sdp);
  const QString sdpStr = QString::fromUtf8(sdp);
  g_free(sdp);

  // mid_to_track_id: mid -> track sid
  publisherMid_ = extractMid(sdpStr);
  QByteArray sd;
  sd += Pb::str(1, "offer");
  sd += Pb::str(2, sdpStr);
  if (!publisherMid_.isEmpty() && !publisherTrackSid_.isEmpty()) {
    QByteArray entry = Pb::str(1, publisherMid_) + Pb::str(2, publisherTrackSid_);
    sd += Pb::msg(4, entry);
  }
  QByteArray msg = Pb::msg(kSignalRequestOffer, sd);
  sendSignalRequest(msg);
}

void LiveKitClient::sendAnswer(const GstWebRTCSessionDescription* desc) {
  gchar* sdp = gst_sdp_message_as_text(desc->sdp);
  const QString sdpStr = QString::fromUtf8(sdp);
  g_free(sdp);
  QByteArray sd;
  sd += Pb::str(1, "answer");
  sd += Pb::str(2, sdpStr);
  QByteArray msg = Pb::msg(kSignalRequestAnswer, sd);
  sendSignalRequest(msg);
}

}  // namespace gl
