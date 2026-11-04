import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '../state/appStore'

interface Suggestion {
  code: string
  name: string
  department: string
  lng: number
  lat: number
}

interface CommuneApiItem {
  nom: string
  code: string
  centre?: { coordinates: [number, number] }
  departement?: { nom: string }
}

const ENDPOINT = 'https://geo.api.gouv.fr/communes'
const DEBOUNCE_MS = 250
const MIN_QUERY = 2
const COMMUNE_ZOOM = 10.5

async function searchCommunes(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = `${ENDPOINT}?nom=${encodeURIComponent(query)}&fields=nom,code,centre,departement&boost=population&limit=6`
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Search failed: ${response.status}`)
  const items = (await response.json()) as CommuneApiItem[]
  return items.flatMap((item) =>
    item.centre
      ? [{ code: item.code, name: item.nom, department: item.departement?.nom ?? '', lng: item.centre.coordinates[0], lat: item.centre.coordinates[1] }]
      : [],
  )
}

export function Search() {
  const { t } = useTranslation()
  const flyTo = useAppStore((state) => state.flyTo)
  const listId = useId()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const [status, setStatus] = useState<'idle' | 'none' | 'error'>('idle')
  const input = useRef<HTMLInputElement>(null)
  const trimmed = query.trim()
  const searching = trimmed.length >= MIN_QUERY

  useEffect(() => {
    if (trimmed.length < MIN_QUERY) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      searchCommunes(trimmed, controller.signal)
        .then((found) => {
          setItems(found)
          setActive(-1)
          setStatus(found.length === 0 ? 'none' : 'idle')
        })
        .catch((error: unknown) => {
          if ((error as Error).name !== 'AbortError') setStatus('error')
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [trimmed])

  const choose = (item: Suggestion) => {
    flyTo({ lng: item.lng, lat: item.lat, zoom: COMMUNE_ZOOM, code: item.code })
    setQuery(item.name)
    setItems([])
    input.current?.blur()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, items.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter' && items.length > 0) {
      event.preventDefault()
      choose(items[active >= 0 ? active : 0])
    } else if (event.key === 'Escape') {
      setItems([])
    }
  }

  const open = searching && items.length > 0
  const message = !searching ? null : status === 'none' ? t('search.none') : status === 'error' ? t('search.error') : null

  return (
    <div className="search">
      <label className="visually-hidden" htmlFor={`${listId}-input`}>
        {t('search.label')}
      </label>
      <input
        ref={input}
        id={`${listId}-input`}
        className="search__input"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder={t('search.placeholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} className="search__list" role="listbox" aria-label={t('search.label')}>
          {items.map((item, index) => (
            <li
              key={item.code}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className="search__option"
              onPointerDown={(event) => {
                event.preventDefault()
                choose(item)
              }}
            >
              <span>{item.name}</span>
              <span className="search__dep">{item.department}</span>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p className="search__message" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
