// Регистрация с подсказкой требований к паролю.
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'
import { useSettingsStore } from '../stores/settings'
import { validatePassword, PASSWORD_HINT } from '../utils/password'
import ServerUrlModal from '../components/ServerUrlModal.vue'

const router = useRouter()
const auth = useAuthStore()
const channels = useChannelsStore()
const settings = useSettingsStore()

const nick = ref('')
const password = ref('')
const confirm = ref('')
const error = ref('')
const busy = ref(false)
const showServerUrl = ref(!settings.hasServer)

const passwordProblem = computed(() => (password.value ? validatePassword(password.value) : null))

async function submit() {
  error.value = ''
  if (!settings.hasServer) {
    error.value = 'Сначала укажите адрес сервера'
    showServerUrl.value = true
    return
  }
  if (!nick.value.trim()) {
    error.value = 'Введите ник'
    return
  }
  const problem = validatePassword(password.value)
  if (problem) {
    error.value = problem
    return
  }
  if (password.value !== confirm.value) {
    error.value = 'Пароли не совпадают'
    return
  }
  busy.value = true
  try {
    await auth.register(nick.value.trim(), password.value)
    router.push('/')
    await channels.init().catch(() => undefined)
  } catch (e: any) {
    error.value = e.message || 'Ошибка регистрации'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="auth-card" @submit.prevent="submit">
      <h1>Golosloom</h1>
      <p class="muted">Регистрация</p>
      <div class="field">
        <label>Ник (уникальный)</label>
        <input v-model="nick" autocomplete="username" placeholder="Ваш ник" />
      </div>
      <div class="field">
        <label>Пароль</label>
        <input v-model="password" type="password" autocomplete="new-password" placeholder="Пароль" />
        <p class="hint-text">{{ PASSWORD_HINT }}</p>
        <p v-if="passwordProblem" class="error-text">{{ passwordProblem }}</p>
      </div>
      <div class="field">
        <label>Повторите пароль</label>
        <input v-model="confirm" type="password" autocomplete="new-password" placeholder="Ещё раз" />
      </div>
      <div v-if="error" class="error-text">{{ error }}</div>
      <button class="primary" type="submit" :disabled="busy">Зарегистрироваться</button>
      <button type="button" class="server-btn" @click="showServerUrl = true">
        ⚙️ Адрес сервера: <span class="muted">{{ settings.serverUrl || 'не указан' }}</span>
      </button>
      <p class="hint-text">
        Уже есть аккаунт? <RouterLink to="/login">Войти</RouterLink>
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
  background: radial-gradient(circle at 30% 20%, #2b2d31, #1e1f22);
}
.auth-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 28px;
  width: 420px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
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
