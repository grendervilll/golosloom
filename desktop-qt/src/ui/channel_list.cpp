#include "ui/channel_list.h"

#include <QListWidgetItem>
#include <QVBoxLayout>

#include "core/app_state.h"

namespace gl {

ChannelList::ChannelList(AppState* state, QWidget* parent) : QWidget(parent), state_(state) {
  setObjectName("sidebar");
  auto* lay = new QVBoxLayout(this);
  lay->setContentsMargins(8, 10, 8, 10);
  lay->setSpacing(8);

  auto* title = new QLabel("Golosloom", this);
  title->setObjectName("chatTitle");
  lay->addWidget(title);

  list_ = new QListWidget(this);
  list_->setObjectName("channelList");
  list_->setFrameShape(QFrame::NoFrame);
  list_->setSelectionMode(QAbstractItemView::SingleSelection);
  list_->setUniformItemSizes(true);
  lay->addWidget(list_);

  connect(list_, &QListWidget::itemClicked, this, [this](QListWidgetItem* item) {
    const qint64 id = item->data(Qt::UserRole).toLongLong();
    emit channelActivated(id);
  });
}

void ChannelList::refresh() {
  list_->clear();
  for (const Channel& c : state_->channels()) {
    QString icon;
    if (c.kind == "dm") {
      icon = "\xF0\x9F\x92\xAC ";  // 💬
    } else if (c.kind == "community") {
      icon = "\xF0\x9F\x91\xA5 ";  // 👥
    } else {
      icon = "\xF0\x9F\x93\xA2 ";  // 📢
    }
    const QString label = icon + c.name;
    auto* item = new QListWidgetItem(label, list_);
    item->setData(Qt::UserRole, c.id);
    item->setToolTip(c.kind == "dm" ? "Личный чат" : c.name);
  }
}

}  // namespace gl
