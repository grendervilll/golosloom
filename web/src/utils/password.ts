// Валидация пароля: минимум 12 символов, разный регистр и спецсимволы.
export const PASSWORD_HINT =
  'Пароль должен содержать минимум 12 символов, заглавные и строчные буквы и спецсимволы (например: !@#$%^&*)'

export function validatePassword(password: string): string | null {
  if (password.length < 12) return 'Пароль слишком короткий: нужно минимум 12 символов'
  if (!/[A-ZА-ЯЁ]/.test(password)) return 'Пароль должен содержать заглавные буквы'
  if (!/[a-zа-яё]/.test(password)) return 'Пароль должен содержать строчные буквы'
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~`]/.test(password))
    return 'Пароль должен содержать спецсимволы'
  return null
}
