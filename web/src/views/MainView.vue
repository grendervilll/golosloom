// Главный экран: каналы, чат, звонки, участники.
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
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

const chatHidden = computed(() => settings.chatHidden)
const inCall = computed(() => calls.connectedCallId > 0)

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
      <CallStage v-if="inCall" />
      <div v-else class="empty-stage">
        <p class="muted">Выберите канал и участников, чтобы начать звонок</p>
      </div>
      <JoinCallBar v-if="!inCall" />
    </div>

    <div v-if="!chatHidden" class="right-col">
      <ChatPanel />
      <ParticipantsPanel />
    </div>

    <IncomingCallOverlay />
    <CallControls v-if="inCall" />

    <AdminPanel v-if="showAdmin" @close="showAdmin = false" />
    <SettingsModal v-if="showSettings" @close="showSettings = false" />
    <InviteModal v-if="showInvite" @close="showInvite = false" />
    <CallModal v-if="showCallPicker" @close="showCallPicker = false" />
    <ServerUrlModal v-if="showServerUrl" @close="showServerUrl = false" />
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
  display: flex;
  flex-direction: column;
  min-width: 0;
  position: relative;
}
.empty-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}
.right-col {
  width: 380px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--bg2);
  border-left: 1px solid var(--border);
}

@media (max-width: 800px) {
  .right-col {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    width: 100%;
    z-index: 50;
  }
  .center-col {
    display: none;
  }
}
</style>
