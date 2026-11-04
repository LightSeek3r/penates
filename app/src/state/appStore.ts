import { detectLang } from '../i18n'
import { createStore } from './store'
import { parseHash } from './urlState'

export const initialState = parseHash(window.location.hash, detectLang(navigator.languages))
export const useAppStore = createStore(initialState)
