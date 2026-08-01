// Тесты валидации пароля.
import { describe, expect, it } from 'vitest'
import { validatePassword, PASSWORD_HINT } from '../utils/password'

describe('валидация пароля', () => {
  it('принимает корректный пароль', () => {
    expect(validatePassword('Abcdef12345!')).toBeNull()
    expect(validatePassword('aB!1qwertyuiopasdfghjkl')).toBeNull()
  })

  it('отклоняет короткие пароли', () => {
    expect(validatePassword('Aa1!')).not.toBeNull()
    expect(validatePassword('Abcdef12!')).not.toBeNull()
  })

  it('отклоняет пароли без заглавных', () => {
    expect(validatePassword('abcdef12345!')).not.toBeNull()
  })

  it('отклоняет пароли без строчных', () => {
    expect(validatePassword('ABCDEF12345!')).not.toBeNull()
  })

  it('отклоняет пароли без спецсимволов', () => {
    expect(validatePassword('AbcdefABCDEF')).not.toBeNull()
  })

  it('отклоняет пустой пароль', () => {
    expect(validatePassword('')).not.toBeNull()
  })

  it('подсказка не пустая', () => {
    expect(PASSWORD_HINT.length).toBeGreaterThan(10)
  })
})
