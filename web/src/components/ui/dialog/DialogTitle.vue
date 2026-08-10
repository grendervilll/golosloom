<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { DialogTitle, type DialogTitleProps } from 'reka-ui'
import { cn } from '../../../lib/utils'

const props = defineProps<DialogTitleProps & { class?: HTMLAttributes['class'] }>()
</script>

<template>
  <DialogTitle
    :class="cn('text-xl leading-tight font-bold tracking-tight', props.class)"
    v-bind="props"
  >
    <slot />
  </DialogTitle>
</template>
