<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <!-- Сетка: кнопки футера растягиваются на всю ширину попапа
       (grid-cols-1 одна кнопка, grid-cols-2 — пополам). -->
  <div :class="cn('grid gap-2', props.class)">
    <slot />
  </div>
</template>
