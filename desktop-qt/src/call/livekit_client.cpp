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
  QByteArray m;
  m += Pb::str(1, candidate);
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
  // Первое сообщение (JoinRequest) передаётся в URL параметром join_request
  // (base64url WrappedJoinRequest {compression=NONE, join_request=...}).
  QByteArray joinRequest;
  QByteArray clientInfo;
  clientInfo += Pb::var(1, 1);        // sdk = GO
  clientInfo += Pb::str(2, "0.1.0");  // version
  clientInfo += Pb::var(3, 3);        // protocol
  joinRequest += Pb::msg(1, clientInfo);
  QByteArray wrapped;
  wrapped += Pb::var(1, 0);  // compression = NONE
  wrapped += Pb::bytes(2, joinRequest);
  // LiveKit требует base64url С паддингом (как btoa в браузере).
  const QByteArray joinB64 = wrapped.toBase64().replace('+', "-").replace('/', "_");
  // Сигналинг LiveKit проксируется Caddy по пути /rtc (v1 — современный
  // протокол: join_request в URL, бинарные WS-сообщения).
  QString base = wsUrl;
  while (base.endsWith('/')) base.chop(1);
  QUrl url(base + "/rtc/v1");
  QUrlQuery q;
  q.addQueryItem("access_token", token);
  q.addQueryItem("join_request", QString::fromLatin1(joinB64));
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
    }
  }
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
      Pb::Reader tr(r.asBytes());
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
  QString candidate;
  int target = 0;
  while (r.next()) {
    if (r.field() == 1) {
      candidate = r.asString();
    } else if (r.field() == 2) {
      target = static_cast<int>(r.asVarint());
    }
  }
  if (candidate.isEmpty()) return;
  GstElement* pc = target == 0 ? pub_ : sub_;
  if (!pc) return;
  g_signal_emit_by_name(pc, "add-ice-candidate", candidate.toUtf8().constData());
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

  GstWebRTCSessionDescription* answer = nullptr;
  g_signal_emit_by_name(sub_, "create-answer", nullptr, &answer);
  g_signal_emit_by_name(sub_, "set-local-description", answer, nullptr);
  sendAnswer(answer);
  gst_webrtc_session_description_free(answer);
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
  gst_element_set_state(bin, GST_STATE_PLAYING);
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
  gst_element_set_state(bin, GST_STATE_PLAYING);
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
        g_signal_emit_by_name(client->pub_, "set-local-description", offer, nullptr);
        client->sendPublisherOffer(offer);
        client->offerSent_ = true;
        gst_webrtc_session_description_free(offer);
      },
      this, nullptr);
  g_signal_emit_by_name(pub_, "create-offer", promise);
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
