/**
 * Bot copy i18n (SPEC §8). One flat catalogue per language with an identical
 * key set — TypeScript enforces parity: a key missing from hi.json/bn.json is
 * a compile error on the `catalogues` map below.
 *
 * Placeholders use `{name}` syntax; unknown placeholders are left in place so
 * a missing param is visible in dev rather than silently swallowed.
 */
import en from './i18n/en.json'
import hi from './i18n/hi.json'
import bn from './i18n/bn.json'

export type Lang = 'en' | 'hi' | 'bn'

/** All bot-copy keys — inferred from the English catalogue. */
export type MessageKey = keyof typeof en

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'hi', 'bn'] as const

const catalogues: Record<Lang, Record<MessageKey, string>> = { en, hi, bn }

/** Coerce a stored/user-supplied language code to a supported one (default en). */
export function normalizeLang(value: string | null | undefined): Lang {
  return value === 'hi' || value === 'bn' ? value : 'en'
}

/** Translate `key` into `lang`, interpolating `{placeholder}` params. */
export function t(lang: Lang, key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogues[lang][key] ?? catalogues.en[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}
