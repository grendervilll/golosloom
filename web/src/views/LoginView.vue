// Вход в систему.
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useChannelsStore } from '../stores/channels'

const router = useRouter()
const auth = useAuthStore()
const channels = useChannelsStore()

const nick = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

async function submit() {
  error.value = ''
  busy.value = true
  try {
    await auth.login(nick.value.trim(), password.value)
    await channels.init()
    router.push('/')
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
      <p class="hint-text">
        Нет аккаунта? <RouterLink to="/register">Зарегистрироваться</RouterLink>
      </p>
    </form>
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
  width: 380px;
  max-width: 92vw;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.auth-card h1 {
  font-size: 24px;
}
</style>
