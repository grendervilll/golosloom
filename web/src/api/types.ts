// Типы данных API

export interface User {
  id: number
  nick: string
  is_server_admin: boolean
  server_banned: boolean
  server_ban_reason?: string
  created_at: string
  avatar?: string | null
}

export interface PublicUser {
  id: number
  nick: string
  is_server_admin: boolean
  online: boolean
}

export type Role = 'user' | 'channel_moderator' | 'channel_admin' | 'server_admin'

export interface Channel {
  id: number
  name: string
  private: boolean
  creator_id: number
  created_at: string
  is_member: boolean
  role?: Role
}

export interface ChannelMember {
  user_id: number
  nick: string
  role: Role
  is_server_admin?: boolean
  online: boolean
  joined_at: string
  avatar?: string | null
}

export interface Message {
  id: number
  channel_id: number
  sender_id: number
  sender_nick: string
  ciphertext: string
  iv: string
  created_at: string
  edited_at?: string
  history?: MessageVersion[]
  deleted: boolean
  deleted_by?: number
  attachment?: Attachment | null
}

export interface Attachment {
  id: number
  filename: string
  mime: string
  size: number
}

export interface MessageVersion {
  ciphertext: string
  iv: string
  at: string
}

export interface Invite {
  id: number
  channel_id: number
  channel_name: string
  invited_by: number
  invited_by_nick: string
  created_at: string
}

export interface Call {
  id: number
  channel_id: number
  initiator_id: number
  status: 'ringing' | 'active' | 'ended'
  created_at: string
  participants: number[]
}

export interface ServerConfig {
  ws_path: string
  livekit_url: string
  max_message_len: number
  turn: { urls: string[]; username: string; credential: string }
}

export interface WSEvent {
  type: string
  data: any
}
