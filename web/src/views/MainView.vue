// Главный экран: каналы слева, чат и звонок в центре, участники справа.
// На мобильных: каналы и участники — выезжающие шторки, внизу — навигация.
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useCallStore } from '../stores/calls'
import { useSettingsStore } from '../stores/settings'
import ChannelSidebar from '../components/ChannelSidebar.vue'
import ChatPanel from '../components/ChatPanel.vue'
import ParticipantsPanel from '../components/ParticipantsPanel.vue'
import CallStage from '../components/CallStage.vue'
import CallControls from '../components/CallControls.vue'
import IncomingCallOverlay from '../components/IncomingCallOverlay.vue'
import JoinCallBar from '../components/JoinCallBar.vue'
import AdminPanel from '../components/AdminPanel.vue'
import SettingsModal from '../components/SettingsModal.vue'
import ServerUrlModal from '../components/ServerUrlModal.vue'
import InviteModal from '../components/InviteModal.vue'
import RegistrationInviteModal from '../components/RegistrationInviteModal.vue'
import CallModal from '../components/CallModal.vue'
import UpdateModal from '../components/UpdateModal.vue'
import MobileTabBar from '../components/MobileTabBar.vue'
import CallBar from '../components/CallBar.vue'
import { initPush } from '../utils/push'

const router = useRouter()
const auth = useAuthStore()
const channels = useChannelsStore()
const calls = useCallStore()
const settings = useSettingsStore()

const showAdmin = ref(false)
const showSettings = ref(false)
const showInvite = ref(false)
const showRegInvite = ref(false)
const showCallPicker = ref(false)
const showServerUrl = ref(false)
const showParticipants = ref(false)
// Мобильная шторка: 'channels' | 'members' | 'none'.
const mobilePanel = ref<'none' | 'channels' | 'members'>('none')
// На мобильных во время звонка: true — показываем чат вместо сцены.
const mobileCallChat = ref(false)

const inCall = computed(() => calls.connectedCallId > 0)
const chatHidden = computed(() => settings.chatHidden)

watch(inCall, (v) => {
  if (!v) mobileCallChat.value = false
})

onMounted(async () => {
  if (!auth.token) {
    router.push('/login')
    return
  }
  // Web Push-уведомления (звонки/сообщения при закрытом приложении).
  try {
    await settings.loadConfig()
    void initPush(settings.api, settings.serverConfig?.vapid_public_key)
  } catch {
    /* пуши не критичны */
  }
})

function logout() {
  auth.logout()
  router.push('/login')
}

function toggleChat() {
  settings.setChatHidden(!settings.chatHidden)
}

function openChannelsDrawer() {
  mobilePanel.value = mobilePanel.value === 'channels' ? 'none' : 'channels'
}
function openMembersDrawer() {
  if (mobilePanel.value === 'channels') mobilePanel.value = 'none'
  showParticipants.value = true
  mobilePanel.value = 'members'
}
function closeDrawers() {
  mobilePanel.value = 'none'
  showParticipants.value = false
}
function onChatToggleParticipants() {
  showParticipants.value = !showParticipants.value
  mobilePanel.value = showParticipants.value ? 'members' : 'none'
}
// Вкладка «Чат» во время звонка на мобильных: переключает чат/сцену.
function onTabChat() {
  if (inCall.value) mobileCallChat.value = !mobileCallChat.value
  closeDrawers()
}
</script>

<template>
  <div
    class="main-layout"
    :class="{ 'drawer-channels': mobilePanel === 'channels', 'drawer-members': mobilePanel === 'members' }"
  >
    <ChannelSidebar
      :key="channels.currentId"
      :class="{ 'drawer-open': mobilePanel === 'channels' }"
      @open-invite="showInvite = true"
      @open-call="showCallPicker = true"
      @toggle-chat="toggleChat"
      @logout="logout"
      @open-admin="showAdmin = true"
      @open-settings="showSettings = true"
    />

    <div class="center-col">
      <!-- Сцена звонка: на мобильном скрывается, когда открыт чат. -->
      <div v-if="inCall" class="stage-wrap" :class="{ hidden: mobileCallChat }">
        <CallStage />
      </div>
      <!-- Чат доступен и во время звонка (на мобильном — через вкладку). -->
      <ChatPanel
        v-if="!chatHidden"
        :class="{ 'in-call': inCall, hidden: inCall && !mobileCallChat }"
        @toggle-participants="onChatToggleParticipants"
        @open-invite="showInvite = true"
        @open-reg-invite="showRegInvite = true"
        @open-call="showCallPicker = true"
      />
      <div v-if="chatHidden && (!inCall || mobileCallChat)" class="empty-chat muted">Чат скрыт</div>
      <CallBar
        v-if="inCall"
        class="call-bar-row"
        @return="mobileCallChat = false"
      />
      <JoinCallBar v-if="!inCall" />
      <CallControls v-if="inCall" />
    </div>

    <ParticipantsPanel
      class="right-col"
      :class="{ open: showParticipants }"
      @close="closeDrawers"
    />

    <!-- Бэкдроп шторок на мобильных (скрыт на десктопе). -->
    <div v-if="mobilePanel !== 'none'" class="mobile-backdrop" @click="closeDrawers"></div>

    <!-- Кнопка возврата к звонку, когда на мобильном открыт чат во время звонка. -->
    <button v-if="inCall && mobileCallChat" class="back-to-call" @click="mobileCallChat = false">
      📞 Вернуться к звонку
    </button>

    <MobileTabBar
      :active="mobilePanel"
      @channels="openChannelsDrawer"
      @chat="onTabChat"
      @members="openMembersDrawer"
    />

    <IncomingCallOverlay />
    <AdminPanel v-if="showAdmin" @close="showAdmin = false" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <InviteModal v-if="showInvite" @close="showInvite = false" />
    <RegistrationInviteModal v-if="showRegInvite" :channel-id="channels.currentId" @close="showRegInvite = false" />
    <CallModal v-if="showCallPicker" @close="showCallPicker = false" />
    <ServerUrlModal v-if="showServerUrl" @close="showServerUrl = false" />
    <UpdateModal />
  </div>
</template>

<style scoped>
.main-layout {
  display: flex;
  height: 100%;
  overflow: hidden;
}
.center-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.stage-wrap {
  flex: 1;
  min-height: 0;
  display: flex;
  border-bottom: 1px solid var(--border);
}
.empty-chat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
/* Во время звонка чат — компактная колонка под сценой. */
.chat-panel.in-call {
  flex: 0 0 300px;
  border-top: 1px solid var(--border);
}
.call-bar-row {
  flex: none;
}

/* Панель участников скрыта по умолчанию, открывается по кнопке 👥. */
.right-col {
  display: none;
}
.right-col.open {
  display: flex;
}

/* Бэкдроп мобильных шторок. */
.mobile-backdrop {
  display: none;
}

/* Кнопка возврата к звонку (мобильные, во время звонка в чате). */
.back-to-call {
  display: none;
}

@media (max-width: 900px) {
  .main-layout {
    flex-direction: column;
  }
  .center-col {
    flex: 1;
    min-height: 0;
  }
  /* На мобильном во время звонка сцена и чат переключаются вкладкой. */
  .hidden {
    display: none !important;
  }
  .back-to-call {
    display: block;
    position: fixed;
    left: 12px;
    bottom: calc(72px + var(--safe-bottom));
    z-index: 80;
    background: var(--accent);
    color: #fff;
    border-radius: 999px;
    padding: 8px 16px;
    font-weight: 600;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    min-height: 44px;
  }
  /* Участники — полноэкранная шторка. */
  .right-col.open {
    position: fixed;
    inset: 0;
    width: 100%;
    z-index: 90;
    animation: slide-up 0.25s ease;
  }
  /* Бэкдроп под шторками, но над контентом. */
  .mobile-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 85;
  }
  @keyframes slide-up {
    from {
      transform: translateY(100%);
    }
    to {
      transform: none;
    }
  }
}
</style>
