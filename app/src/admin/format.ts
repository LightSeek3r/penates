const number = new Intl.NumberFormat('fr-FR')
export const formatCount = (value: number) => number.format(value)
