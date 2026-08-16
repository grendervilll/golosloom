#pragma once
#include <QObject>
#include <QVector>
#include <QWebSocket>

#include <gst/gst.h>
#include <gst/webrtc/webrtc.h>

namespace gl {

// LiveKit-клиент: сигналинг (WrappedJoinRequest + SignalRequest/Response)
// + медиа через GStreamer webrtcbin (publisher/subscriber).
class LiveKitClient : public QObject {
  Q_OBJECT
 public:
  explicit LiveKitClient(QObject* parent = nullptr);

  void connectRoom(const QString& wsUrl, const QString& token, bool publishAudio, bool publishVideo);
  void disconnectRoom();
  void setMicEnabled(bool on);
  void setCamEnabled(bool on);

  bool connected() const { return connected_; }
  void setFakeAudio(bool on) { fakeAudio_ = on; }
  bool publisherAnswered() const { return publisherAnswered_; }
  bool subscriberOfferReceived() const { return subscriberOfferReceived_; }
  QString publisherSdp() const { return publisherSdp_; }
  bool micEnabled() const { return micOn_; }
  bool camEnabled() const { return camOn_; }

 signals:
  void connectedChanged(bool connected);
  void publisherAnsweredSignal();
  void subscriberOfferSignal();
  void participantJoined(const QString& identity, const QString& name);
  void participantLeft(const QString& identity);
  void remoteTrack(const QString& identity, const QString& trackId, bool audio);

 private slots:
  void onWsConnected();
  void onWsMessage(const QString& msg);
  void onWsDisconnected();

 private:
  void sendSignalRequest(const QByteArray& proto);
  friend void onPubIce(GstElement*, guint, gchar*, gpointer);
  friend void onSubIce(GstElement*, guint, gchar*, gpointer);
  friend void onPubNegotiationNeeded(GstElement*, gpointer);
  void handleResponse(const QByteArray& data);
  void handleOffer(const QByteArray& sdpBytes);
  void handleTrickle(const QByteArray& trickle);
  void handleTrackPublished(const QByteArray& data);
  void handleParticipantUpdate(const QByteArray& data);
  void startPublish();
  void createPublisherOffer();
  void handleSdpAnswer(const QByteArray& sdpBytes);

  void initPublisherPipeline();
  void initSubscriberPipeline();
  void sendPublisherOffer(const GstWebRTCSessionDescription* desc);
  void sendAnswer(const GstWebRTCSessionDescription* desc);

  QWebSocket ws_;
  bool connected_ = false;
  QString roomUrl_;
  QString token_;
  bool publishAudio_ = false;
  bool publishVideo_ = false;
  bool micOn_ = true;
  bool camOn_ = true;
  bool fakeAudio_ = false;
  bool publisherAnswered_ = false;
  bool subscriberOfferReceived_ = false;
  QString publisherSdp_;

  QString publisherTrackCid_;
  QString publisherTrackSid_;
  QString publisherMid_;

  GstElement* pub_ = nullptr;   // webrtcbin publisher (элемент)
  GstElement* sub_ = nullptr;   // webrtcbin subscriber (элемент)
  GstElement* pubBin_ = nullptr;
  GstElement* subBin_ = nullptr;
  GstElement* pubAudioSrc_ = nullptr;
  GstElement* pubVideoSrc_ = nullptr;
  bool offerSent_ = false;
  bool started_ = false;
  // Кандидаты, пришедшие до создания webrtcbin (добавляются при создании).
  struct PendingTrickle {
    int target = 0;
    guint mlineindex = 0;
    QString candidate;
  };
  QVector<PendingTrickle> pendingTrickles_;
  void flushPendingTrickles();
};

}  // namespace gl
