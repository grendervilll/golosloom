// Главный экран: каналы слева, чат и звонок в центре, участники справа.
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
import CallModal from '../components/CallModal.vue'
import UpdateModal from '../components/UpdateModal.vue'

const router = useRouter()
const auth = useAuthStore()
const channels = useChannelsStore()
const calls = useCallStore()
const settings = useSettingsStore()

const showAdmin = ref(false)
const showSettings = ref(false)
const showInvite = ref(false)
const showCallPicker = ref(false)
const showServerUrl = ref(false)
const showParticipants = ref(false)

const inCall = computed(() => calls.connectedCallId > 0)
const chatHidden = computed(() => settings.chatHidden)

onMounted(() => {
  if (!auth.token) router.push('/login')
})

function logout() {
  auth.logout()
  router.push('/login')
}

function toggleChat() {
  settings.setChatHidden(!settings.chatHidden)
}
</script>

<template>
  <div class="main-layout">
    <ChannelSidebar
      :key="channels.currentId"
      @open-invite="showInvite = true"
      @open-call="showCallPicker = true"
      @toggle-chat="toggleChat"
      @logout="logout"
      @open-admin="showAdmin = true"
      @open-settings="showSettings = true"
    />

    <div class="center-col">
      <div v-if="inCall" class="stage-wrap">
        <CallStage />
      </div>
      <ChatPanel
        v-if="!chatHidden"
        :class="{ 'in-call': inCall }"
        @toggle-participants="showParticipants = true"
        @open-invite="showInvite = true"
        @open-call="showCallPicker = true"
      />
      <div v-else class="empty-chat muted">Чат скрыт</div>
      <JoinCallBar v-if="!inCall" />
      <CallControls v-if="inCall" />
    </div>

    <ParticipantsPanel
      class="right-col"
      :class="{ open: showParticipants }"
      @close="showParticipants = false"
    />

    <IncomingCallOverlay />
    <AdminPanel v-if="showAdmin" @close="showAdmin = false" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <InviteModal v-if="showInvite" @close="showInvite = false" />
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

/* Панель участников скрыта по умолчанию, открывается по кнопке 👥. */
.right-col {
  display: none;
}
.right-col.open {
  display: flex;
}
@media (max-width: 900px) {
  .main-layout {
    flex-direction: column;
  }
  .center-col {
    flex: 1;
    min-height: 0;
  }
  .right-col.open {
    position: fixed;
    inset: 0;
    width: 100%;
    z-index: 80;
  }
}
</style>
