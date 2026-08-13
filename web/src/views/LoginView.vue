// Вход в систему (с настройкой адреса сервера — для Tauri при первом запуске).
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useSettingsStore } from '../stores/settings'
import ServerUrlModal from '../components/ServerUrlModal.vue'

const router = useRouter()
const auth = useAuthStore()
const channels = useChannelsStore()
const settings = useSettingsStore()

const nick = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)
const showServerUrl = ref(!settings.hasServer)

async function submit() {
  error.value = ''
  if (!settings.hasServer) {
    error.value = 'Сначала укажите адрес сервера'
    showServerUrl.value = true
    return
  }
  busy.value = true
  try {
    await auth.login(nick.value.trim(), password.value)
    router.push('/')
    await channels.init().catch(() => undefined)
  } catch (e: any) {
    error.value = e.message || 'Ошибка входа'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="submit">
      <img class="logo" src="/logo.png" alt="Golosloom" />
      <h1>Golosloom</h1>
      <p class="muted">Вход на сервер</p>
      <div class="field">
        <label>Ник</label>
        <input v-model="nick" autocomplete="username" placeholder="Ваш ник" />
      </div>
      <div class="field">
        <label>Пароль</label>
        <input v-model="password" type="password" autocomplete="current-password" placeholder="Пароль" />
      </div>
      <div v-if="error" class="error-text">{{ error }}</div>
      <button class="primary" type="submit" :disabled="busy">Войти</button>
      <button type="button" class="server-btn" @click="showServerUrl = true">
        ⚙️ Адрес сервера: <span class="muted">{{ settings.serverUrl || 'не указан' }}</span>
      </button>
      <p class="hint-text">
        Нет аккаунта? <RouterLink to="/register">Зарегистрироваться</RouterLink>
      </p>
    </form>

    <ServerUrlModal v-if="showServerUrl" @close="showServerUrl = false" />
  </div>
</template>

<style scoped>
.auth-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 30% 20%, var(--auth-grad-1), var(--auth-grad-2));
}
.auth-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px;
  width: 380px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.auth-card h1 {
  font-size: 24px;
  text-align: center;
  margin: 0;
}
.logo {
  width: 96px;
  height: 96px;
  border-radius: 24px;
  object-fit: cover;
  align-self: center;
}
.server-btn {
  background: transparent;
  border: 1px dashed var(--border);
  font-size: 13px;
  color: var(--text);
  text-align: left;
}
.server-btn:hover {
  background: var(--bg3);
}
</style>
