import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/OverviewPage.vue') },
    { path: '/kanban', component: () => import('./pages/KanbanPage.vue') },
    { path: '/processes', component: () => import('./pages/ProcessListPage.vue') },
    { path: '/processes/:id', component: () => import('./pages/ProcessDetailPage.vue') },
    { path: '/entities', component: () => import('./pages/EntityListPage.vue') },
    { path: '/entities/:id', component: () => import('./pages/EntityDetailPage.vue') },
    { path: '/dag', component: () => import('./pages/ServiceDagPage.vue') },
    { path: '/workload', component: () => import('./pages/WorkloadPage.vue') },
    { path: '/entity-network', component: () => import('./pages/EntityNetworkPage.vue') },
    { path: '/agent-log', component: () => import('./pages/AgentLogPage.vue') },
    { path: '/business-goals', component: () => import('./pages/BusinessGoalsPage.vue') },
    { path: '/approvals', component: () => import('./pages/ApprovalsPage.vue') },
    { path: '/governance', component: () => import('./pages/GovernancePage.vue') },
  ],
})
