import { createRouter, createWebHashHistory } from 'vue-router'
import LoginView from './views/LoginView.vue'
import RegisterView from './views/RegisterView.vue'
import MainView from './views/MainView.vue'

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', component: MainView },
    { path: '/login', component: LoginView },
    { path: '/register', component: RegisterView },
  ],
})
