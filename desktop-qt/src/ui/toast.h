#pragma once
#include <QWidget>

namespace gl {

// Оверлей уведомлений в стиле Telegram: баннеры появляются в правом
// верхнем углу окна, висят 3 секунды и плавно исчезают.
class ToastOverlay : public QWidget {
  Q_OBJECT
 public:
  explicit ToastOverlay(QWidget* parent = nullptr);

  // title — кто (ник), body — что (текст сообщения / "начал звонок").
  void showToast(const QString& title, const QString& body);

 protected:
  bool eventFilter(QObject* watched, QEvent* event) override;

 private:
  QWidget* container_;
  void reposition();
};

}  // namespace gl
