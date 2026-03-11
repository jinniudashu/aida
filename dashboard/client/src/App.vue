<script setup lang="ts">
import { h, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { NLayout, NLayoutSider, NLayoutContent, NMenu, NMessageProvider } from 'naive-ui'
import type { MenuOption } from 'naive-ui'
import { GridOutline, AlbumsOutline, ListOutline, PeopleOutline, GitNetworkOutline, AnalyticsOutline, ShareSocialOutline, DocumentTextOutline, TrophyOutline, CheckmarkCircleOutline, ShieldCheckmarkOutline } from '@vicons/ionicons5'
import { NIcon } from 'naive-ui'
import type { MenuDividerOption } from 'naive-ui'
import { sse } from './sse'

const router = useRouter()
const route = useRoute()

onMounted(() => sse.connect())
onUnmounted(() => sse.disconnect())

function icon(comp: any) {
  return () => h(NIcon, null, { default: () => h(comp) })
}

const menuOptions: (MenuOption | MenuDividerOption)[] = [
  { label: 'Overview', key: '/', icon: icon(GridOutline) },
  { label: 'Kanban', key: '/kanban', icon: icon(AlbumsOutline) },
  { label: 'Processes', key: '/processes', icon: icon(ListOutline) },
  { label: 'Entities', key: '/entities', icon: icon(PeopleOutline) },
  { type: 'divider' },
  { label: 'Service DAG', key: '/dag', icon: icon(GitNetworkOutline) },
  { label: 'Workload', key: '/workload', icon: icon(AnalyticsOutline) },
  { label: 'Entity Network', key: '/entity-network', icon: icon(ShareSocialOutline) },
  { type: 'divider' },
  { label: 'Agent Log', key: '/agent-log', icon: icon(DocumentTextOutline) },
  { label: 'Business Goals', key: '/business-goals', icon: icon(TrophyOutline) },
  { label: 'Approvals', key: '/approvals', icon: icon(CheckmarkCircleOutline) },
  { label: 'Management', key: '/management', icon: icon(ShieldCheckmarkOutline) },
]

const activeKey = computed(() => {
  const path = route.path
  if (path.startsWith('/processes')) return '/processes'
  if (path.startsWith('/entities') && !path.startsWith('/entity-network')) return '/entities'
  if (path.startsWith('/kanban')) return '/kanban'
  if (path.startsWith('/dag')) return '/dag'
  if (path.startsWith('/workload')) return '/workload'
  if (path.startsWith('/entity-network')) return '/entity-network'
  if (path.startsWith('/agent-log')) return '/agent-log'
  if (path.startsWith('/business-goals')) return '/business-goals'
  if (path.startsWith('/approvals')) return '/approvals'
  if (path.startsWith('/management')) return '/management'
  return '/'
})

function handleMenuUpdate(key: string) {
  router.push(key)
}
</script>

<template>
  <NMessageProvider>
    <NLayout has-sider style="height: 100vh">
      <NLayoutSider bordered :width="200" :collapsed-width="0">
        <div style="padding: 16px; font-weight: bold; font-size: 16px">BPS Dashboard</div>
        <NMenu
          :options="menuOptions"
          :value="activeKey"
          @update:value="handleMenuUpdate"
        />
      </NLayoutSider>
      <NLayoutContent style="padding: 24px; overflow: auto">
        <RouterView />
      </NLayoutContent>
    </NLayout>
  </NMessageProvider>
</template>
