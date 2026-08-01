package perm

import (
	"golosloom/server/internal/models"
	"golosloom/server/internal/store"
)

// Defaults — права групп по умолчанию. Админ сервера может переопределить
// их для конкретного канала (таблица channel_role_permissions).
var Defaults = map[models.Role]map[models.Permission]bool{
	models.RoleUser: {
		models.PermSendMessage: true,
	},
	models.RoleChannelModerator: {
		models.PermSendMessage: true,
		models.PermDeleteMessage: true,
		models.PermBan:           true,
		models.PermKick:          true,
		models.PermInvite:        true,
	},
	models.RoleChannelAdmin: {
		models.PermSendMessage:   true,
		models.PermDeleteMessage: true,
		models.PermBan:           true,
		models.PermKick:          true,
		models.PermInvite:        true,
		models.PermDeleteChannel: true,
		models.PermManageMembers: true,
	},
}

// Can определяет, разрешено ли действие для роли в канале.
// Админ сервера имеет все права. Переопределения прав группы в канале
// приоритетнее значений по умолчанию.
func Can(st *store.Store, channelID int64, role models.Role, perm models.Permission) bool {
	if role == models.RoleServerAdmin {
		return true
	}
	overrides, err := st.ChannelPermissions(channelID)
	if err != nil {
		return Defaults[role][perm]
	}
	if m, ok := overrides[role]; ok {
		if v, exists := m[perm]; exists {
			return v
		}
	}
	return Defaults[role][perm]
}
