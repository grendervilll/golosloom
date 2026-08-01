// Иконки ролей: корона (админ сервера), щит (админ канала), меч (модератор),
// человечек (пользователь).
import type { Role, User } from '../api/types'

export function roleOf(user: User | null | undefined, role?: Role): Role {
  if (user?.is_server_admin) return 'server_admin'
  return role || 'user'
}

export function roleIcon(user?: User | null, role?: Role): string {
  switch (roleOf(user, role)) {
    case 'server_admin':
      return '👑'
    case 'channel_admin':
      return '🛡️'
    case 'channel_moderator':
      return '⚔️'
    default:
      return '👤'
  }
}

export function roleLabel(role: Role): string {
  switch (role) {
    case 'server_admin':
      return 'Админ сервера'
    case 'channel_admin':
      return 'Админ канала'
    case 'channel_moderator':
      return 'Модератор'
    default:
      return 'Пользователь'
  }
}

export function roleColor(role: Role): string {
  switch (role) {
    case 'server_admin':
      return 'var(--yellow)'
    case 'channel_admin':
      return 'var(--accent)'
    case 'channel_moderator':
      return 'var(--green)'
    default:
      return 'var(--text-dim)'
  }
}
