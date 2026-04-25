/**
 * src/api/places.ts
 * Google Places API wrapper — Text Search + Place Details + Geocoding.
 */

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string
const GOOGLE_MAPS_BASE = '/api/google'
const GOOGLE_PLACES_BASE = '/api/google-places'
const NOMINATIM_BASE = '/api/nominatim'

if (!GOOGLE_API_KEY) {
  console.warn(
    'Missing VITE_GOOGLE_MAPS_API_KEY. Add it to .env.local and restart `npm run dev`.',
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type ProviderType = 'all' | 'therapist' | 'psychiatrist' | 'crisis' | 'support_group' | 'rehab'

export interface Place {
  id: string
  name: string
  address: string
  lat: number | undefined
  lng: number | undefined
  rating: number | null
  reviewCount: number
  openNow: boolean | null
  priceLevel: number | null
  photoRef: string | null
  types: string[]
  fallbackPhone?: string | null
  fallbackHours?: string[] | null
  fallbackOpenNow?: boolean | null
}

export interface PlaceDetails {
  phone: string | null
  website: string | null
  googleUrl: string | null
  hours: string[] | null
  isOpenNow: boolean | null
  rating: number | null
  reviewCount: number
  priceLevel: number | null
  reviews: Array<{
    author: string
    text: string
    rating: number
    time: string
  }>
}

export interface GeocodeResult {
  lat: number
  lng: number
  formatted: string
}

export interface AddressSuggestion extends GeocodeResult {
  id: string
}

type GoogleApiError = {
  error?: {
    code?: number
    message?: string
    status?: string
  }
  status?: string
  error_message?: string
}

type GooglePlaceNew = {
  id: string
  displayName?: {
    text?: string
  }
  formattedAddress?: string
  location?: {
    latitude?: number
    longitude?: number
  }
  rating?: number
  userRatingCount?: number
  regularOpeningHours?: {
    openNow?: boolean
    weekdayDescriptions?: string[]
  }
  currentOpeningHours?: {
    openNow?: boolean
    weekdayDescriptions?: string[]
  }
  priceLevel?: string
  photos?: Array<{
    name?: string
  }>
  types?: string[]
  nationalPhoneNumber?: string
  internationalPhoneNumber?: string
  websiteUri?: string
  googleMapsUri?: string
  reviews?: Array<{
    authorAttribution?: {
      displayName?: string
    }
    text?: {
      text?: string
    }
    rating?: number
    relativePublishTimeDescription?: string
  }>
}

type NominatimResult = {
  lat: string
  lon: string
  display_name: string
  osm_type?: string
  osm_id?: number
  name?: string
  type?: string
  category?: string
  address?: Record<string, string | undefined>
  extratags?: Record<string, string | undefined>
}

// ─── Search query mapping ────────────────────────────────────────────────────

export const PROVIDER_TYPES: Record<ProviderType, string> = {
  all: 'mental health therapist psychiatrist counselor',
  therapist: 'therapist psychologist counselor',
  psychiatrist: 'psychiatrist mental health clinic',
  crisis: 'crisis center mental health emergency',
  support_group: 'mental health support group community',
  rehab: 'rehabilitation center substance abuse treatment',
}

// ─── API functions ───────────────────────────────────────────────────────────

export async function searchProviders(
  lat: number,
  lng: number,
  type: ProviderType = 'all',
  radiusMeters = 16000,
): Promise<Place[]> {
  const query = PROVIDER_TYPES[type] || PROVIDER_TYPES.all
  const res = await fetch(`${GOOGLE_PLACES_BASE}/v1/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.formattedAddress',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.regularOpeningHours',
        'places.currentOpeningHours',
        'places.priceLevel',
        'places.photos',
        'places.types',
        'places.googleMapsUri',
      ].join(','),
    },
    body: JSON.stringify({
      textQuery: query,
      locationBias: {
        circle: {
          center: {
            latitude: lat,
            longitude: lng,
          },
          radius: Math.min(radiusMeters, 50000),
        },
      },
      maxResultCount: 20,
    }),
  })
  const data = (await res.json()) as GoogleApiError & { places?: GooglePlaceNew[] }

  if (!res.ok || data.error) {
    console.warn(getGoogleErrorMessage(data, 'Places API (New)'))
    return searchProvidersWithNominatim(lat, lng, type, radiusMeters)
  }

  return (data.places || []).map(normalizePlaceNew)
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  if (placeId.startsWith('osm-') || placeId.startsWith('demo-')) {
    return {
      phone: null,
      website: null,
      googleUrl: null,
      hours: null,
      isOpenNow: null,
      rating: null,
      reviewCount: 0,
      priceLevel: null,
      reviews: [],
    }
  }

  const res = await fetch(`${GOOGLE_PLACES_BASE}/v1/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': GOOGLE_API_KEY,
      'X-Goog-FieldMask': [
        'id',
        'displayName',
        'formattedAddress',
        'nationalPhoneNumber',
        'internationalPhoneNumber',
        'websiteUri',
        'googleMapsUri',
        'regularOpeningHours',
        'currentOpeningHours',
        'rating',
        'userRatingCount',
        'priceLevel',
        'reviews',
      ].join(','),
    },
  })
  const data = (await res.json()) as GoogleApiError & GooglePlaceNew

  if (!res.ok || data.error) {
    throw new Error(getGoogleErrorMessage(data, 'Place Details'))
  }

  return normalizeDetailsNew(data)
}

export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const url = new URL(`${GOOGLE_MAPS_BASE}/maps/api/geocode/json`, window.location.origin)
  url.searchParams.set('address', address + ', USA')
  url.searchParams.set('components', 'country:US')
  url.searchParams.set('key', GOOGLE_API_KEY)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Geocoding API error: ${res.status}`)
  const data = await res.json() as GoogleApiError & { results?: any[] }

  const results = data.results || []

  if (data.status !== 'OK' || !results.length) {
    if (data.status === 'REQUEST_DENIED') {
      console.warn(getGoogleErrorMessage(data, 'Geocoding API'))
      return geocodeAddressWithNominatim(address)
    }

    throw new Error(getGoogleErrorMessage(data, 'Geocoding API'))
  }

  const result = results[0]
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formatted: result.formatted_address,
  }
}

export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const cleanedQuery = query.trim()
  if (cleanedQuery.length < 3) return []

  const url = new URL(`${NOMINATIM_BASE}/search`, window.location.origin)
  url.searchParams.set('q', cleanedQuery)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '5')
  url.searchParams.set('countrycodes', 'us')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('dedupe', '1')

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })
  if (!res.ok) return []

  const data = await res.json() as NominatimResult[]
  const suggestions = data
    .map((result, index) => ({
      id: `${result.osm_type || 'place'}-${result.osm_id || index}-${result.lat}-${result.lon}`,
      lat: Number(result.lat),
      lng: Number(result.lon),
      formatted: result.display_name,
    }))
    .filter((suggestion) => Number.isFinite(suggestion.lat) && Number.isFinite(suggestion.lng))

  return dedupeSuggestions(suggestions)
}

async function geocodeAddressWithNominatim(address: string): Promise<GeocodeResult> {
  const url = new URL(`${NOMINATIM_BASE}/search`, window.location.origin)
  url.searchParams.set('q', address)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'us')

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Backup geocoding error: ${res.status}`)

  const data = await res.json() as NominatimResult[]
  const result = data[0]

  if (!result) {
    throw new Error('Location not found. Try a city name, address, or ZIP code.')
  }

  return {
    lat: Number(result.lat),
    lng: Number(result.lon),
    formatted: result.display_name,
  }
}

async function searchProvidersWithNominatim(
  lat: number,
  lng: number,
  type: ProviderType,
  radiusMeters: number,
): Promise<Place[]> {
  const radiusMiles = radiusMeters / 1609.344
  const latDelta = Math.max(radiusMiles / 69, 0.05)
  const lngDelta = Math.max(radiusMiles / (69 * Math.cos((lat * Math.PI) / 180)), 0.05)
  const viewbox = [lng - lngDelta, lat + latDelta, lng + lngDelta, lat - latDelta].join(',')
  const queries = getNominatimQueries(type)
  const results = await Promise.all(
    queries.map(async (query) => {
      const url = new URL(`${NOMINATIM_BASE}/search`, window.location.origin)
      url.searchParams.set('q', query)
      url.searchParams.set('format', 'jsonv2')
      url.searchParams.set('limit', '10')
      url.searchParams.set('countrycodes', 'us')
      url.searchParams.set('addressdetails', '1')
      url.searchParams.set('extratags', '1')
      url.searchParams.set('viewbox', viewbox)
      url.searchParams.set('bounded', '1')

      const res = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
        },
      })

      if (!res.ok) {
        return []
      }

      return (await res.json()) as NominatimResult[]
    }),
  )

  return mergePlaces(
    results
      .flat()
      .map((result) => normalizeNominatimPlace(result))
      .filter((place): place is Place => Boolean(place))
      .filter((place) => {
        if (place.lat === undefined || place.lng === undefined) return false
        return distanceMiles(lat, lng, place.lat, place.lng) <= radiusMiles
      }),
    getSupplementalPlaces(lat, lng, radiusMiles),
  )
}

function getNominatimQueries(type: ProviderType): string[] {
  if (type === 'therapist') return ['therapist', 'counseling center', 'psychologist']
  if (type === 'psychiatrist') return ['psychiatrist', 'mental health clinic']
  if (type === 'crisis') return ['mental health crisis center', 'behavioral health center']
  if (type === 'rehab') return ['substance abuse treatment', 'rehabilitation center']
  return ['mental health clinic', 'therapist', 'psychiatrist', 'counseling center', 'behavioral health center']
}

function normalizeNominatimPlace(raw: NominatimResult): Place | null {
  const lat = Number(raw.lat)
  const lng = Number(raw.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  const name = raw.name || raw.address?.amenity || raw.display_name.split(',')[0]
  const website = raw.extratags?.website || raw.extratags?.['contact:website']
  const hours = raw.extratags?.opening_hours ? [raw.extratags.opening_hours] : null
  const types = [raw.type, raw.category, raw.extratags?.healthcare, raw.extratags?.amenity].filter(Boolean) as string[]

  return {
    id: `osm-${raw.osm_type || 'place'}-${raw.osm_id || `${lat}-${lng}`}`,
    name,
    address: formatNominatimAddress(raw),
    lat,
    lng,
    rating: null,
    reviewCount: 0,
    openNow: null,
    priceLevel: null,
    photoRef: null,
    types: website ? [...types, `website:${website}`] : types,
    fallbackPhone: raw.extratags?.phone || raw.extratags?.['contact:phone'] || null,
    fallbackHours: hours,
    fallbackOpenNow: getOpenNowFromHours(hours),
  }
}

function formatNominatimAddress(raw: NominatimResult): string {
  const address = raw.address
  if (!address) return raw.display_name

  const lineOne = [address.house_number, address.road].filter(Boolean).join(' ')
  const lineTwo = [address.city || address.town || address.village, address.state, address.postcode]
    .filter(Boolean)
    .join(', ')

  return [lineOne, lineTwo].filter(Boolean).join(', ') || raw.display_name
}

function mergePlaces(...groups: Place[][]): Place[] {
  const seen = new Set<string>()
  return groups
    .flat()
    .filter((place) => {
      const key = getPlaceDedupeKey(place)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function dedupeSuggestions(suggestions: AddressSuggestion[]): AddressSuggestion[] {
  const seen = new Set<string>()
  return suggestions.filter((suggestion) => {
    const key = getSuggestionDedupeKey(suggestion)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getSuggestionDedupeKey(suggestion: AddressSuggestion): string {
  const withoutCounty = suggestion.formatted
    .split(',')
    .map((part) => part.trim())
    .filter((part) => !/county$/i.test(part))
    .join(', ')

  return `${normalizeText(withoutCounty)}-${suggestion.lat.toFixed(3)}-${suggestion.lng.toFixed(3)}`
}

function getPlaceDedupeKey(place: Place): string {
  const name = normalizeText(place.name)
  const address = normalizeText(place.address)
  const lat = place.lat?.toFixed(3) ?? ''
  const lng = place.lng?.toFixed(3) ?? ''
  const compactName = name
    .replace(/\b(the|inc|llc|pc|center|centre|clinic|services|service|health|mental|behavioral|behavioural)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return `${compactName || name}-${address || `${lat}-${lng}`}`
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getSupplementalPlaces(lat: number, lng: number, radiusMiles: number): Place[] {
  const bmcHours = expandWeeklyHours(['Monday-Friday: 8:00 AM - 8:00 PM', 'Saturday-Sunday: 9:00 AM - 5:00 PM'])
  const lindemannHours = expandWeeklyHours(['Monday-Friday: 9:00 AM - 5:00 PM'])
  const nypTherapyHours = expandWeeklyHours(['Monday-Friday: 8:00 AM - 6:00 PM', 'Saturday: 8:00 AM - 3:00 PM'])
  const elevateYouHours = expandWeeklyHours(['Monday-Thursday: 9:00 AM - 7:00 PM', 'Friday: 9:00 AM - 5:00 PM'])
  const demoPlaces: Place[] = [
    {
      id: 'osm-boston-lindemann',
      name: 'Erich Lindemann Mental Health Center',
      address: '25 Staniford Street, Boston, MA 02114',
      lat: 42.3633475,
      lng: -71.0630517,
      rating: null,
      reviewCount: 0,
      openNow: null,
      priceLevel: null,
      photoRef: null,
      types: ['mental health services', 'clinic', 'website:https://www.bhchp.org/lindemann-mental-health-center'],
      fallbackPhone: '(617) 626-8000',
      fallbackHours: lindemannHours,
      fallbackOpenNow: getOpenNowFromHours(lindemannHours),
    },
    {
      id: 'osm-boston-bmc-cbhc',
      name: 'Boston Medical Center CBHC',
      address: '850 Harrison Avenue, Boston, MA',
      lat: 42.3342,
      lng: -71.0731,
      rating: null,
      reviewCount: 0,
      openNow: getOpenNowFromHours(bmcHours),
      priceLevel: null,
      photoRef: null,
      types: ['mental health services', 'behavioral health', 'website:https://www.bmc.org/cbhc'],
      fallbackPhone: '(617) 414-5470',
      fallbackHours: bmcHours,
      fallbackOpenNow: getOpenNowFromHours(bmcHours),
    },
    {
      id: 'demo-nyc-psychiatry-and-therapy',
      name: 'Psychiatry and Therapy of New York City',
      address: '255 Broadway, Suite 2713, New York, NY',
      lat: 40.7131,
      lng: -74.0076,
      rating: null,
      reviewCount: 0,
      openNow: null,
      priceLevel: null,
      photoRef: null,
      types: ['psychiatry', 'therapy', 'website:https://psychiatryandtherapy.nyc/'],
      fallbackPhone: '(212) 693-1010',
      fallbackHours: null,
      fallbackOpenNow: null,
    },
    {
      id: 'demo-nyc-nyptherapy-greenwich',
      name: 'New York Psychiatry + Therapy - Greenwich Village',
      address: '1 Fifth Avenue, Suite 1BB, New York, NY 10003',
      lat: 40.7322,
      lng: -73.9965,
      rating: null,
      reviewCount: 0,
      openNow: getOpenNowFromHours(nypTherapyHours),
      priceLevel: null,
      photoRef: null,
      types: ['psychiatry', 'therapy', 'website:https://www.nyptherapy.com/'],
      fallbackPhone: '(212) 301-0517',
      fallbackHours: nypTherapyHours,
      fallbackOpenNow: getOpenNowFromHours(nypTherapyHours),
    },
    {
      id: 'demo-nyc-nyptherapy-chelsea',
      name: 'New York Psychiatry + Therapy - Chelsea',
      address: '420 West 24th Street, Suite 1C, New York, NY 10011',
      lat: 40.7471,
      lng: -74.0015,
      rating: null,
      reviewCount: 0,
      openNow: getOpenNowFromHours(nypTherapyHours),
      priceLevel: null,
      photoRef: null,
      types: ['psychiatry', 'therapy', 'website:https://www.nyptherapy.com/'],
      fallbackPhone: '(212) 301-0517',
      fallbackHours: nypTherapyHours,
      fallbackOpenNow: getOpenNowFromHours(nypTherapyHours),
    },
    {
      id: 'demo-nyc-nyptherapy-union-square',
      name: 'New York Psychiatry + Therapy - Union Square',
      address: '85 Fifth Avenue, Suite 911, New York, NY 10003',
      lat: 40.7371,
      lng: -73.9924,
      rating: null,
      reviewCount: 0,
      openNow: getOpenNowFromHours(nypTherapyHours),
      priceLevel: null,
      photoRef: null,
      types: ['psychiatry', 'therapy', 'website:https://www.nyptherapy.com/'],
      fallbackPhone: '(212) 301-0517',
      fallbackHours: nypTherapyHours,
      fallbackOpenNow: getOpenNowFromHours(nypTherapyHours),
    },
    {
      id: 'demo-nyc-elevate-you-woodhull',
      name: 'Elevate You - NYC Health + Hospitals/Woodhull',
      address: '760 Broadway, Brooklyn, NY 11206',
      lat: 40.7005,
      lng: -73.9418,
      rating: null,
      reviewCount: 0,
      openNow: getOpenNowFromHours(elevateYouHours),
      priceLevel: null,
      photoRef: null,
      types: ['behavioral health', 'youth mental health', 'website:https://portal.311.nyc.gov/article/?kanumber=KA-03704'],
      fallbackPhone: '(844) 692-4692',
      fallbackHours: elevateYouHours,
      fallbackOpenNow: getOpenNowFromHours(elevateYouHours),
    },
    {
      id: 'demo-nyc-elevate-you-queens',
      name: 'Elevate You - NYC Health + Hospitals/Queens',
      address: '82-68 164 Street, Queens, NY 11432',
      lat: 40.7152,
      lng: -73.8031,
      rating: null,
      reviewCount: 0,
      openNow: getOpenNowFromHours(elevateYouHours),
      priceLevel: null,
      photoRef: null,
      types: ['behavioral health', 'youth mental health', 'website:https://portal.311.nyc.gov/article/?kanumber=KA-03704'],
      fallbackPhone: '(844) 692-4692',
      fallbackHours: elevateYouHours,
      fallbackOpenNow: getOpenNowFromHours(elevateYouHours),
    },
    {
      id: 'demo-nyc-gotham-broadway',
      name: 'NYC Health + Hospitals/Gotham Health, Broadway Behavioral Health',
      address: '815 Broadway, Brooklyn, NY 11206',
      lat: 40.699,
      lng: -73.941,
      rating: null,
      reviewCount: 0,
      openNow: null,
      priceLevel: null,
      photoRef: null,
      types: ['behavioral health', 'therapy', 'website:https://www.nychealthandhospitals.org/broadway/services/behavioral-health/'],
      fallbackPhone: '(844) 692-4692',
      fallbackHours: null,
      fallbackOpenNow: null,
    },
  ]

  return demoPlaces.filter((place) => {
    if (place.lat === undefined || place.lng === undefined) return false
    return distanceMiles(lat, lng, place.lat, place.lng) <= radiusMiles
  })
}

function getOpenNowFromHours(hours: string[] | null): boolean | null {
  if (!hours?.length) return null

  const now = new Date()
  const today = now.getDay()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  for (const line of hours) {
    const parsed = parseHoursLine(line)
    if (!parsed || !parsed.days.includes(today)) continue
    return currentMinutes >= parsed.openMinutes && currentMinutes < parsed.closeMinutes
  }

  return false
}

function expandWeeklyHours(lines: string[]): string[] {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const weeklyHours = new Map<number, string>()

  for (const line of lines) {
    const parsed = parseHoursLine(line)
    if (!parsed) continue

    const hoursText = line.split(': ').slice(1).join(': ')
    parsed.days.forEach((day) => weeklyHours.set(day, hoursText))
  }

  if (!weeklyHours.size) return lines

  return dayNames.map((day, index) => `${day}: ${weeklyHours.get(index) ?? 'Closed'}`)
}

function parseHoursLine(line: string): { days: number[]; openMinutes: number; closeMinutes: number } | null {
  const [daysText, hoursText] = line.split(': ')
  if (!daysText || !hoursText) return null

  const hoursMatch = hoursText.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\s*-\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i)
  if (!hoursMatch) return null

  const [, openHour, openMinute = '0', openPeriod, closeHour, closeMinute = '0', closePeriod] = hoursMatch
  const days = parseDays(daysText)
  if (!days.length) return null

  return {
    days,
    openMinutes: toMinutes(Number(openHour), Number(openMinute), openPeriod),
    closeMinutes: toMinutes(Number(closeHour), Number(closeMinute), closePeriod),
  }
}

function parseDays(text: string): number[] {
  const dayIndexes: Record<string, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }
  const normalized = text.toLowerCase()
  const [startText, endText] = normalized.split('-')
  const start = dayIndexes[startText.trim()]
  const end = endText ? dayIndexes[endText.trim()] : start

  if (start === undefined || end === undefined) return []
  if (start <= end) return Array.from({ length: end - start + 1 }, (_, index) => start + index)
  return [...Array.from({ length: 7 - start }, (_, index) => start + index), ...Array.from({ length: end + 1 }, (_, index) => index)]
}

function toMinutes(hour: number, minute: number, period: string): number {
  const normalizedHour = period.toLowerCase() === 'pm' && hour !== 12 ? hour + 12 : period.toLowerCase() === 'am' && hour === 12 ? 0 : hour
  return normalizedHour * 60 + minute
}

export function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('Could not get your location. Please enter it manually.')),
    )
  })
}

// ─── Normalizers ─────────────────────────────────────────────────────────────

function normalizePlaceNew(raw: GooglePlaceNew): Place {
  const photoName = raw.photos?.[0]?.name || null
  return {
    id: raw.id,
    name: raw.displayName?.text || 'Unnamed provider',
    address: raw.formattedAddress || 'Address unavailable',
    lat: raw.location?.latitude,
    lng: raw.location?.longitude,
    rating: raw.rating ?? null,
    reviewCount: raw.userRatingCount || 0,
    openNow: raw.currentOpeningHours?.openNow ?? raw.regularOpeningHours?.openNow ?? null,
    priceLevel: normalizePriceLevel(raw.priceLevel),
    photoRef: photoName,
    types: raw.types || [],
  }
}

function normalizeDetailsNew(raw: GooglePlaceNew): PlaceDetails {
  return {
    phone: raw.nationalPhoneNumber || raw.internationalPhoneNumber || null,
    website: raw.websiteUri || null,
    googleUrl: raw.googleMapsUri || null,
    hours: raw.currentOpeningHours?.weekdayDescriptions || raw.regularOpeningHours?.weekdayDescriptions || null,
    isOpenNow: raw.currentOpeningHours?.openNow ?? raw.regularOpeningHours?.openNow ?? null,
    rating: raw.rating ?? null,
    reviewCount: raw.userRatingCount || 0,
    priceLevel: normalizePriceLevel(raw.priceLevel),
    reviews: (raw.reviews || []).slice(0, 3).map((r) => ({
      author: r.authorAttribution?.displayName || 'Google user',
      text: r.text?.text || '',
      rating: r.rating || 0,
      time: r.relativePublishTimeDescription || '',
    })),
  }
}

function normalizePriceLevel(level?: string): number | null {
  const levels: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  }

  return level && level in levels ? levels[level] : null
}

function getGoogleErrorMessage(data: GoogleApiError, apiName: string): string {
  const message = data.error?.message || data.error_message || data.status || 'Unknown error'

  if (/not been used|disabled|not activated|REQUEST_DENIED|PERMISSION_DENIED/i.test(message)) {
    return `${apiName} is not enabled for this API key/project. Enable Geocoding API and Places API (New) in Google Cloud, then restart the dev server. Google said: ${message}`
  }

  return `${apiName} error: ${message}`
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function getPhotoUrl(photoRef: string | null, maxWidth = 400): string | null {
  if (!photoRef) return null
  return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxWidth}&photo_reference=${photoRef}&key=${GOOGLE_API_KEY}`
}

export function formatPriceLevel(level: number | null): string {
  const labels: Record<number, string> = {
    0: 'Free',
    1: 'Low cost ($)',
    2: 'Moderate ($$)',
    3: 'Higher cost ($$$)',
    4: 'Premium ($$$$)',
  }
  return level !== null && level in labels ? labels[level] : 'Cost unknown'
}

/** Haversine distance in miles between two coordinates. */
export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8
  const toRad = (v: number) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
