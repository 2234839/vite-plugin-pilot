<template>
  <div class="user-card">
    <div class="avatar">{{ name[0] }}</div>
    <div class="info">
      <div class="name">{{ name }}</div>
      <div class="role">{{ role }}</div>
      <div v-if="email" class="email">{{ email }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  role: string
  email?: string
}>()
</script>

<style scoped>
.user-card { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem; background: #0f172a; border-radius: 6px; margin-bottom: 0.5rem; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: #3b82f6; display: flex; align-items: center; justify-content: center; font-weight: bold; }
.info { flex: 1; }
.name { font-weight: 500; }
.role { color: #94a3b8; font-size: 0.875rem; }
.email { color: #64748b; font-size: 0.75rem; margin-top: 2px; }
</style>
