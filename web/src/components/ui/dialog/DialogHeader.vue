<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '../../../lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>

<template>
  <!-- Разделитель под заголовком: заголовок визуально отделён от контента. -->
  <div
    :class="
      cn(
        'flex flex-col gap-2 border-border border-b pb-4 text-center sm:text-left',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>
