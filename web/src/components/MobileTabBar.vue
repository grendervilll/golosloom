// Нижняя навигация для мобильных: каналы / чат / участники.
// На десктопе скрыта.
<script setup lang="ts">
defineProps<{ active: 'none' | 'channels' | 'members' }>()
defineEmits<{ (e: 'channels'): void; (e: 'chat'): void; (e: 'members'): void }>()
</script>

<template>
  <nav class="mobile-tabbar">
    <button :class="{ active: active === 'channels' }" @click="$emit('channels')">
      <span class="icon">📋</span>
      <span>Каналы</span>
    </button>
    <button :class="{ active: active === 'none' }" @click="$emit('chat')">
      <span class="icon">💬</span>
      <span>Чат</span>
    </button>
    <button :class="{ active: active === 'members' }" @click="$emit('members')">
      <span class="icon">👥</span>
      <span>Участники</span>
    </button>
  </nav>
</template>

<style scoped>
.mobile-tabbar {
  display: none;
}

@media (max-width: 900px) {
  .mobile-tabbar {
    display: flex;
    flex: none;
    gap: 8px;
    padding: 6px 8px calc(6px + var(--safe-bottom));
    background: var(--bg2);
    border-top: 1px solid var(--border);
  }
  .mobile-tabbar button {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    background: transparent;
    color: var(--text-dim);
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    min-height: 44px;
    padding: 6px 4px;
  }
  .mobile-tabbar button .icon {
    font-size: 18px;
    line-height: 1;
  }
  .mobile-tabbar button.active {
    background: var(--bg4);
    color: var(--text);
  }
}
</style>
