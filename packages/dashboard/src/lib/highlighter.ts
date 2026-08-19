/**
 * Fine-grained Shiki highlighter.
 *
 * Importing `codeToHtml` from the `shiki` entry point pulls in every bundled
 * grammar, which produced roughly 300 lazy chunks and about 10 MB of build
 * output. The dashboard only ever highlights the languages it maps below, so
 * the core highlighter is built with exactly those, loaded on demand.
 *
 * The JavaScript regex engine is used instead of the Oniguruma one so the
 * 600 KB WebAssembly payload never ships.
 */

import { createHighlighterCore, type HighlighterCore } from '@shikijs/core'
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript'

/** Languages the code preview can request, mapped to their grammar loaders. */
const languageLoaders = {
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  python: () => import('@shikijs/langs/python'),
  go: () => import('@shikijs/langs/go'),
  rust: () => import('@shikijs/langs/rust'),
  css: () => import('@shikijs/langs/css'),
  json: () => import('@shikijs/langs/json'),
  html: () => import('@shikijs/langs/html'),
  markdown: () => import('@shikijs/langs/markdown'),
  yaml: () => import('@shikijs/langs/yaml'),
} as const

export type SupportedLanguage = keyof typeof languageLoaders

export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return Object.prototype.hasOwnProperty.call(languageLoaders, lang)
}

let highlighterPromise: Promise<HighlighterCore> | null = null
const loadedLanguages = new Set<string>()

async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighterCore({
      themes: [import('@shikijs/themes/github-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  }
  return highlighterPromise
}

/**
 * Highlight code and return the generated HTML, or null when the language is
 * unsupported or highlighting fails. Callers render plain text on null.
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  if (!isSupportedLanguage(lang)) return null
  try {
    const highlighter = await getHighlighter()
    if (!loadedLanguages.has(lang)) {
      const loaded = await languageLoaders[lang]()
      await highlighter.loadLanguage(loaded.default)
      loadedLanguages.add(lang)
    }
    return highlighter.codeToHtml(code, { lang, theme: 'github-dark' })
  } catch {
    return null
  }
}
