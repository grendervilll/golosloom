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
const invite = ref('')
const error = ref('')
const busy = ref(false)
const showServerUrl = ref(!settings.hasServer)

const passwordProblem = computed(() => (password.value ? validatePassword(password.value) : null))

// Код приглашения из ссылки: https://.../#/register?invite=TOKEN
{
  const m = window.location.hash.match(/invite=([a-f0-9]+)/i)
  if (m) invite.value = m[1]
}

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
    await auth.register(nick.value.trim(), password.value, invite.value.trim() || undefined)
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
      <img class="logo" src="/logo.png" alt="Golosloom" />
      <h1>Golosloom</h1>
      <p class="muted">Регистрация</p>
      <div class="field">
        <label>Ник (уникальный)</label>
        <input v-model="nick" autocomplete="username" placeholder="Ваш ник" />
      </div>
      <div class="field">
        <label>Пароль</label>
        <input v-model="password" type="password" autocomplete="new-password" placeholder="Пароль" />        <p class="hint-text">{{ PASSWORD_HINT }}</p>
        <p v-if="passwordProblem" class="error-text">{{ passwordProblem }}</p>
      </div>
      <div class="field">
        <label>Повторите пароль</label>
        <input v-model="confirm" type="password" autocomplete="new-password" placeholder="Ещё раз" />
      </div>
      <div class="field">
        <label>Код приглашения</label>
        <input v-model="invite" placeholder="Код из приглашения (если есть)" />
        <p class="hint-text">Если регистрация на сервере запрещена — нужен одноразовый код, действует 5 минут.</p>
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
  background: radial-gradient(circle at 30% 20%, var(--auth-grad-1), var(--auth-grad-2));
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
.logo {
  width: 96px;
  height: 96px;
  border-radius: 24px;
  object-fit: cover;
  align-self: center;
}
.auth-card h1 {
  text-align: center;
  margin: 0;
}
</style>
