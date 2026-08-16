#pragma once
#include <QLabel>
#include <QPushButton>
#include <QWidget>

namespace gl {

class CallManager;

// Оверлей звонков: карточка входящего звонка (Принять/Отклонить)
// и панель активного звонка (микрофон/завершить), как в веб-клиенте.
class CallOverlay : public QWidget {
  Q_OBJECT
 public:
  explicit CallOverlay(CallManager* calls, QWidget* parent = nullptr);

  void showIncoming(qint64 callId, const QString& nick);
  void hideIncoming();

 protected:
  bool eventFilter(QObject* watched, QEvent* event) override;

 private:
  void reposition();

  CallManager* calls_;
  QWidget* container_;
  // Входящий звонок
  QWidget* incomingCard_;
  QLabel* incomingNick_;
  QPushButton* acceptBtn_;
  QPushButton* declineBtn_;
  qint64 incomingId_ = 0;
};

}  // namespace gl