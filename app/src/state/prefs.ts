// Preferences kept in this browser only; nothing here is ever sent anywhere.
const OPT_IN_KEY = 'settling.optin.safety'

/** Whether the visitor asked to see recorded-crime layers. Off by default and when storage is unavailable. */
export function readOptIn(): boolean {
  try {
    return localStorage.getItem(OPT_IN_KEY) === '1'
  } catch {
    return false
  }
}

export function writeOptIn(value: boolean): void {
  try {
    if (value) localStorage.setItem(OPT_IN_KEY, '1')
    else localStorage.removeItem(OPT_IN_KEY)
  } catch {
    // Without storage the choice lasts for this page only.
  }
}
