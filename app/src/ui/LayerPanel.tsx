import { useTranslation } from 'react-i18next'
import { PRICE_TYPES } from '../domain/place'
import { useAppStore } from '../state/appStore'

export function LayerPanel() {
  const { t } = useTranslation()
  const priceType = useAppStore((state) => state.priceType)
  const setPriceType = useAppStore((state) => state.setPriceType)
  const open = useAppStore((state) => state.layersOpen)
  const setOpen = useAppStore((state) => state.setLayersOpen)

  return (
    <section className="panel layers" data-open={open} aria-label={t('layers.open')}>
      <div className="panel__head">
        <h2 className="panel__title">{t('layers.title')}</h2>
        <button type="button" className="button button--quiet layers__close" onClick={() => setOpen(false)}>
          {t('layers.close')}
        </button>
      </div>
      <div className="layer-row">
        <p className="layer-row__name">{t('layers.price')}</p>
        <p className="layer-row__hint">{t('layers.priceHint')}</p>
      </div>
      <fieldset className="segmented">
        <legend>{t('layers.typeLabel')}</legend>
        {PRICE_TYPES.map((type) => (
          <label key={type} className="segmented__option">
            <input type="radio" name="price-type" value={type} checked={priceType === type} onChange={() => setPriceType(type)} />
            <span>{t(`layers.type.${type}`)}</span>
          </label>
        ))}
      </fieldset>
    </section>
  )
}
