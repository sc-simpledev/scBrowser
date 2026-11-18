import { calculate, formatCalculation } from './calc'

/**
 * Unit conversions for the address bar, worked out on this computer: `5 km in miles`,
 * `30 c to f`, `2.5 kg in lb`. Currencies are left out, as they need rates from somewhere.
 */

interface Unit {
  /** What it's called in the answer. */
  symbol: string
  kind: 'length' | 'mass' | 'volume' | 'speed' | 'time' | 'data' | 'area' | 'temperature'
  /** How many of the kind's base unit one of these is. Temperatures convert by formula. */
  factor: number
  names: string[]
}

const UNITS: Unit[] = [
  { symbol: 'mm', kind: 'length', factor: 0.001, names: ['mm', 'millimetre', 'millimetres', 'millimeter', 'millimeters'] },
  { symbol: 'cm', kind: 'length', factor: 0.01, names: ['cm', 'centimetre', 'centimetres', 'centimeter', 'centimeters'] },
  { symbol: 'm', kind: 'length', factor: 1, names: ['m', 'metre', 'metres', 'meter', 'meters'] },
  { symbol: 'km', kind: 'length', factor: 1000, names: ['km', 'kms', 'kilometre', 'kilometres', 'kilometer', 'kilometers'] },
  { symbol: 'in', kind: 'length', factor: 0.0254, names: ['in', 'inch', 'inches', '"'] },
  { symbol: 'ft', kind: 'length', factor: 0.3048, names: ['ft', 'foot', 'feet', "'"] },
  { symbol: 'yd', kind: 'length', factor: 0.9144, names: ['yd', 'yds', 'yard', 'yards'] },
  { symbol: 'mi', kind: 'length', factor: 1609.344, names: ['mi', 'mile', 'miles'] },
  { symbol: 'nmi', kind: 'length', factor: 1852, names: ['nmi', 'nautical mile', 'nautical miles'] },

  { symbol: 'mg', kind: 'mass', factor: 0.001, names: ['mg', 'milligram', 'milligrams'] },
  { symbol: 'g', kind: 'mass', factor: 1, names: ['g', 'gram', 'grams'] },
  { symbol: 'kg', kind: 'mass', factor: 1000, names: ['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'] },
  { symbol: 't', kind: 'mass', factor: 1_000_000, names: ['t', 'tonne', 'tonnes'] },
  { symbol: 'oz', kind: 'mass', factor: 28.349523125, names: ['oz', 'ounce', 'ounces'] },
  { symbol: 'lb', kind: 'mass', factor: 453.59237, names: ['lb', 'lbs', 'pound', 'pounds'] },
  { symbol: 'st', kind: 'mass', factor: 6350.29318, names: ['st', 'stone', 'stones'] },

  { symbol: 'ml', kind: 'volume', factor: 0.001, names: ['ml', 'millilitre', 'millilitres', 'milliliter', 'milliliters'] },
  { symbol: 'L', kind: 'volume', factor: 1, names: ['l', 'litre', 'litres', 'liter', 'liters'] },
  { symbol: 'tsp', kind: 'volume', factor: 0.00492892159375, names: ['tsp', 'teaspoon', 'teaspoons'] },
  { symbol: 'tbsp', kind: 'volume', factor: 0.01478676478125, names: ['tbsp', 'tablespoon', 'tablespoons'] },
  { symbol: 'cups', kind: 'volume', factor: 0.25, names: ['cup', 'cups'] },
  { symbol: 'fl oz', kind: 'volume', factor: 0.0295735295625, names: ['fl oz', 'floz', 'fluid ounce', 'fluid ounces'] },
  { symbol: 'pt', kind: 'volume', factor: 0.473176473, names: ['pt', 'pint', 'pints'] },
  { symbol: 'gal', kind: 'volume', factor: 3.785411784, names: ['gal', 'gallon', 'gallons'] },

  { symbol: 'km/h', kind: 'speed', factor: 1 / 3.6, names: ['km/h', 'kmh', 'kph', 'kmph'] },
  { symbol: 'm/s', kind: 'speed', factor: 1, names: ['m/s', 'mps'] },
  { symbol: 'mph', kind: 'speed', factor: 0.44704, names: ['mph', 'mi/h'] },
  { symbol: 'kn', kind: 'speed', factor: 1852 / 3600, names: ['kn', 'knot', 'knots', 'kt'] },

  { symbol: 'ms', kind: 'time', factor: 0.001, names: ['ms', 'millisecond', 'milliseconds'] },
  { symbol: 's', kind: 'time', factor: 1, names: ['s', 'sec', 'secs', 'second', 'seconds'] },
  { symbol: 'min', kind: 'time', factor: 60, names: ['min', 'mins', 'minute', 'minutes'] },
  { symbol: 'h', kind: 'time', factor: 3600, names: ['h', 'hr', 'hrs', 'hour', 'hours'] },
  { symbol: 'days', kind: 'time', factor: 86_400, names: ['d', 'day', 'days'] },
  { symbol: 'weeks', kind: 'time', factor: 604_800, names: ['wk', 'week', 'weeks'] },
  { symbol: 'years', kind: 'time', factor: 31_557_600, names: ['yr', 'yrs', 'year', 'years'] },

  { symbol: 'B', kind: 'data', factor: 1, names: ['b', 'byte', 'bytes'] },
  { symbol: 'KB', kind: 'data', factor: 1e3, names: ['kb', 'kilobyte', 'kilobytes'] },
  { symbol: 'MB', kind: 'data', factor: 1e6, names: ['mb', 'megabyte', 'megabytes'] },
  { symbol: 'GB', kind: 'data', factor: 1e9, names: ['gb', 'gigabyte', 'gigabytes'] },
  { symbol: 'TB', kind: 'data', factor: 1e12, names: ['tb', 'terabyte', 'terabytes'] },
  { symbol: 'KiB', kind: 'data', factor: 1024, names: ['kib'] },
  { symbol: 'MiB', kind: 'data', factor: 1024 ** 2, names: ['mib'] },
  { symbol: 'GiB', kind: 'data', factor: 1024 ** 3, names: ['gib'] },
  { symbol: 'TiB', kind: 'data', factor: 1024 ** 4, names: ['tib'] },

  { symbol: 'm²', kind: 'area', factor: 1, names: ['m2', 'm²', 'sqm', 'square metre', 'square metres', 'square meter', 'square meters'] },
  { symbol: 'km²', kind: 'area', factor: 1e6, names: ['km2', 'km²', 'square kilometre', 'square kilometres', 'square kilometer', 'square kilometers'] },
  { symbol: 'ft²', kind: 'area', factor: 0.09290304, names: ['ft2', 'ft²', 'sqft', 'square foot', 'square feet'] },
  { symbol: 'ha', kind: 'area', factor: 10_000, names: ['ha', 'hectare', 'hectares'] },
  { symbol: 'acres', kind: 'area', factor: 4046.8564224, names: ['ac', 'acre', 'acres'] },

  { symbol: '°C', kind: 'temperature', factor: 1, names: ['c', '°c', 'celsius', 'degc', 'degrees c', 'degrees celsius'] },
  { symbol: '°F', kind: 'temperature', factor: 1, names: ['f', '°f', 'fahrenheit', 'degf', 'degrees f', 'degrees fahrenheit'] },
  { symbol: 'K', kind: 'temperature', factor: 1, names: ['k', 'kelvin'] }
]

const BY_NAME = new Map(UNITS.flatMap((unit) => unit.names.map((name) => [name, unit] as const)))

const toKelvin = (value: number, symbol: string) => (symbol === '°C' ? value + 273.15 : symbol === '°F' ? ((value - 32) * 5) / 9 + 273.15 : value)
const fromKelvin = (value: number, symbol: string) => (symbol === '°C' ? value - 273.15 : symbol === '°F' ? ((value - 273.15) * 9) / 5 + 32 : value)

export interface Conversion {
  value: number
  /** The answer as shown, such as `3.10686 mi`. */
  text: string
  /** Just the number, for copying. */
  answer: string
}

const PATTERN = /^(.+?)\s*([a-z°²"'][a-z°²/ "']*?)\s+(?:in|to|as|into)\s+([a-z°²"'][a-z°²/ "']*)$/i

/** Converts `<amount> <unit> in|to <unit>`, or gives `null` for anything else. */
export function convertUnits(raw: string): Conversion | null {
  const match = PATTERN.exec(raw.trim().replace(/\s+/g, ' '))
  if (!match) return null
  const [, amountText, fromName, toName] = match
  const from = BY_NAME.get(fromName!.trim().toLowerCase())
  const to = BY_NAME.get(toName!.trim().toLowerCase())
  if (!from || !to || from.kind !== to.kind) return null
  const amount = /^-?\d+(\.\d+)?$/.test(amountText!.trim()) ? Number(amountText) : calculate(amountText!)
  if (amount === null || !Number.isFinite(amount)) return null
  const value = from.kind === 'temperature' ? fromKelvin(toKelvin(amount, from.symbol), to.symbol) : (amount * from.factor) / to.factor
  // Six significant figures is plenty for a conversion, and reads better than twelve.
  const answer = formatCalculation(Number(value.toPrecision(6)))
  return { value, answer, text: `${answer} ${to.symbol}` }
}
