import { langFromPath, pathForLang } from '../i18n'
import { readOptIn, writeOptIn } from './prefs'
import { createStore } from './store'
import { parseHash } from './urlState'

const lang = langFromPath(window.location.pathname)

// Links shared before the language moved into the path carried `l=en` in the hash; send them to the English page once.
if (lang === 'fr' && new URLSearchParams(window.location.hash.slice(1)).get('l') === 'en') {
  window.location.replace(`${pathForLang('en')}${window.location.hash}`)
}

export const initialState = parseHash(window.location.hash, lang)
export const useAppStore = createStore(initialState, readOptIn(), writeOptIn)
