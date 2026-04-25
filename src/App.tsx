import { useEffect, useState } from 'react'
import './App.css'
import {
  geocodeAddress,
  searchProviders,
  getPlaceDetails,
  suggestAddresses,
  distanceMiles,
  type AddressSuggestion,
  type Place,
  type PlaceDetails,
  type ProviderType,
} from './api/places'

// ─── Types ───────────────────────────────────────────────────────────────────

type Clinic = {
  id: string
  name: string
  address: string
  lat: number
  lng: number
  distanceMiles: number
  phone: string | null
  website: string | null
  googleUrl: string | null
  rating: number | null
  reviewCount: number
  isOpenNow: boolean | null
  hours: string[] | null
  serviceLabel: string
  services: string[]
}

type ResourceFilters = {
  therapy: boolean
  psychiatry: boolean
  telehealth: boolean
}

// ─── Fallback (only shown before first search) ───────────────────────────────

const initialPlaceholder: Clinic = {
  id: 'placeholder',
  name: 'Search above to find real providers near you',
  address: '',
  lat: 0,
  lng: 0,
  distanceMiles: 0,
  phone: null,
  website: null,
  googleUrl: null,
  rating: null,
  reviewCount: 0,
  isOpenNow: null,
  hours: null,
  serviceLabel: 'Mental health services',
  services: [
    'Enter your city, ZIP code, or address above',
    'Adjust the distance and resource filters as needed',
    'Click "Search" to see verified providers from Google',
    'Call providers to confirm services, insurance, and availability',
  ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a Get Directions link to Google Maps. */
function directionsUrl(clinic: Clinic): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(clinic.address)}&destination_place_id=${clinic.id}`
}

/** Infer service label and bullets from Google place types and name. */
function inferServices(name: string, types: string[]): { label: string; services: string[] } {
  const lowerName = name.toLowerCase()
  const typesSet = new Set(types)

  let label = 'Mental health services'
  const services: string[] = []

  if (lowerName.includes('psychiatr') || typesSet.has('doctor')) {
    label = 'Psychiatry and medication management'
    services.push('Psychiatric evaluations and medication management')
  }
  if (lowerName.includes('therap') || lowerName.includes('counsel') || lowerName.includes('psycholog')) {
    label = 'Therapy and counseling'
    services.push('Individual, family, or group therapy')
  }
  if (lowerName.includes('crisis') || lowerName.includes('emergency')) {
    label = 'Crisis and urgent mental health support'
    services.push('Same-day crisis assessment and stabilization')
  }
  if (lowerName.includes('rehab') || lowerName.includes('substance') || lowerName.includes('recovery')) {
    label = 'Substance use and recovery'
    services.push('Substance use treatment and recovery support')
  }
  if (lowerName.includes('support') || lowerName.includes('community')) {
    services.push('Peer support and community programs')
  }

  if (services.length === 0) {
    services.push('Mental health services and counseling')
  }
  services.push('Call to confirm services, insurance, and availability')

  return { label, services }
}

/** Map filter checkboxes to a ProviderType for the search query. */
function filtersToProviderType(filters: ResourceFilters): ProviderType {
  const { therapy, psychiatry } = filters
  if (therapy && !psychiatry) return 'therapist'
  if (psychiatry && !therapy) return 'psychiatrist'
  return 'all'
}

/** Locally filter results by checkbox combo (after Google returns them). */
function applyResourceFilter(clinics: Clinic[], filters: ResourceFilters): Clinic[] {
  if (!filters.therapy && !filters.psychiatry && !filters.telehealth) {
    return clinics
  }
  return clinics.filter((c) => {
    const text = `${c.name} ${c.serviceLabel} ${c.services.join(' ')}`.toLowerCase()
    const matchesTherapy = filters.therapy && /therap|counsel|psycholog/.test(text)
    const matchesPsych = filters.psychiatry && /psychiatr|medication|doctor/.test(text)
    const matchesTele = filters.telehealth && /tele|virtual|online/.test(text)
    return matchesTherapy || matchesPsych || matchesTele
  })
}

function dedupeClinics(clinics: Clinic[]): Clinic[] {
  const seen = new Set<string>()
  return clinics.filter((clinic) => {
    const key = getClinicDedupeKey(clinic)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getClinicDedupeKey(clinic: Clinic): string {
  const compactName = normalizeText(clinic.name)
    .replace(/\b(the|inc|llc|pc|center|centre|clinic|services|service|health|mental|behavioral|behavioural)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const address = normalizeText(clinic.address)
  return `${compactName || normalizeText(clinic.name)}-${address || `${clinic.lat.toFixed(3)}-${clinic.lng.toFixed(3)}`}`
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Convert Google Place + Details into our Clinic shape. */
function toClinic(place: Place, details: PlaceDetails | null, originLat: number, originLng: number): Clinic {
  const { label, services } = inferServices(place.name, place.types)
  const lat = place.lat ?? 0
  const lng = place.lng ?? 0
  const fallbackWebsite = place.types.find((type) => type.startsWith('website:'))?.replace('website:', '') ?? null
  return {
    id: place.id,
    name: place.name,
    address: place.address,
    lat,
    lng,
    distanceMiles: distanceMiles(originLat, originLng, lat, lng),
    phone: details?.phone ?? place.fallbackPhone ?? null,
    website: details?.website ?? fallbackWebsite,
    googleUrl: details?.googleUrl ?? null,
    rating: place.rating,
    reviewCount: place.reviewCount,
    isOpenNow: details?.isOpenNow ?? place.openNow ?? place.fallbackOpenNow ?? null,
    hours: details?.hours ?? place.fallbackHours ?? null,
    serviceLabel: label,
    services,
  }
}

// ─── UI subcomponents ────────────────────────────────────────────────────────

function StarRating({ rating, count }: { rating: number | null; count: number }) {
  if (rating === null) return null
  return (
    <p className="rating-line" aria-label={`Rated ${rating} out of 5 from ${count} reviews`}>
      <span className="rating-stars" aria-hidden="true">★</span>
      <span className="rating-value">{rating.toFixed(1)}</span>
      {count > 0 && <span className="rating-count"> ({count} review{count === 1 ? '' : 's'})</span>}
    </p>
  )
}

function OpenStatus({ isOpenNow }: { isOpenNow: boolean | null }) {
  if (isOpenNow === null) {
    return (
      <div className="open-now is-unknown">
        <span className="pulse" aria-hidden="true"></span>
        <span>Hours need confirmation</span>
      </div>
    )
  }
  return (
    <div className={isOpenNow ? 'open-now' : 'open-now is-closed'}>
      <span className="pulse" aria-hidden="true"></span>
      <span>{isOpenNow ? 'Open now' : 'Closed now'}</span>
    </div>
  )
}

function ClinicCard({ clinic }: { clinic: Clinic }) {
  const isPlaceholder = clinic.id === 'placeholder'
  return (
    <article className="clinic-card">
      <div className="clinic-main">
        <div className="clinic-heading">
          <h2>
            {clinic.website ? (
              <a href={clinic.website} target="_blank" rel="noreferrer">{clinic.name}</a>
            ) : clinic.googleUrl ? (
              <a href={clinic.googleUrl} target="_blank" rel="noreferrer">{clinic.name}</a>
            ) : (
              <span>{clinic.name}</span>
            )}
          </h2>
          {!isPlaceholder && <p className="clinic-meta">{clinic.distanceMiles.toFixed(1)} miles away</p>}
          <p className="clinic-type">{clinic.serviceLabel}</p>
          <StarRating rating={clinic.rating} count={clinic.reviewCount} />
        </div>

        <ul className="service-list">
          {clinic.services.map((service) => (
            <li key={service}>{service}</li>
          ))}
        </ul>

        <div className="clinic-actions">
          {clinic.phone && (
            <p className="phone-number">
              <span>Phone number:</span> <a href={`tel:${clinic.phone}`}>{clinic.phone}</a>
            </p>
          )}
          {!isPlaceholder && (
            <a className="directions-link" href={directionsUrl(clinic)} target="_blank" rel="noreferrer">
              Get directions →
            </a>
          )}
        </div>
      </div>

      <div className="clinic-hours">
        {!isPlaceholder && <OpenStatus isOpenNow={clinic.isOpenNow} />}
        {clinic.hours && clinic.hours.length > 0 ? (
          <dl>
            {clinic.hours.map((line) => {
              const [day, ...rest] = line.split(': ')
              return (
                <div key={line}>
                  <dt>{day.slice(0, 3)}</dt>
                  <dd>{rest.join(': ') || '—'}</dd>
                </div>
              )
            })}
          </dl>
        ) : (
          !isPlaceholder && <p className="hours-text">Hours unavailable. Call to confirm.</p>
        )}
        {clinic.address && <p className="address-text">{clinic.address}</p>}
      </div>
    </article>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

function App() {
  const resultsPerPage = 10
  const [location, setLocation] = useState('')
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([])
  const [isSuggesting, setIsSuggesting] = useState(false)
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null)
  const [distanceInput, setDistanceInput] = useState('5')
  const [status, setStatus] = useState('Search a city, ZIP, or address to find nearby support options')
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [clinics, setClinics] = useState<Clinic[]>([initialPlaceholder])
  const [currentPage, setCurrentPage] = useState(1)
  const [isSearching, setIsSearching] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState<ResourceFilters>({
    therapy: true,
    psychiatry: true,
    telehealth: false,
  })

  useEffect(() => {
    const trimmedLocation = location.trim()
    if (trimmedLocation.length < 3 || selectedAddress?.formatted === trimmedLocation) {
      setAddressSuggestions([])
      return
    }

    let isCurrent = true
    const timer = window.setTimeout(async () => {
      setIsSuggesting(true)
      try {
        const suggestions = await suggestAddresses(trimmedLocation)
        if (isCurrent) {
          setAddressSuggestions(suggestions)
        }
      } catch {
        if (isCurrent) {
          setAddressSuggestions([])
        }
      } finally {
        if (isCurrent) {
          setIsSuggesting(false)
        }
      }
    }, 350)

    return () => {
      isCurrent = false
      window.clearTimeout(timer)
    }
  }, [location, selectedAddress])

  async function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const place = location.trim()
    const distance = getValidDistance()
    if (!place) {
      setError('Enter a city, ZIP, or address first.')
      return
    }

    if (distance === null) {
      setError('Distance must be at least 1 mile.')
      return
    }

    setError('')
    setDistanceInput(String(distance))
    setIsSearching(true)
    setStatus(`Searching within ${distance} miles of ${place}...`)

    try {
      // 1. Geocode the user's input, or reuse the confirmed address selection.
      const geo = selectedAddress?.formatted === place ? selectedAddress : await geocodeAddress(place)

      // 2. Search Google Places using filter-derived query.
      const providerType = filtersToProviderType(filters)
      const radiusMeters = Math.min(distance, 50) * 1609.344
      const places = await searchProviders(geo.lat, geo.lng, providerType, radiusMeters)

      // 3. Fetch details for top N (parallel).
      const topPlaces = places.slice(0, 12)
      const detailsList = await Promise.all(
        topPlaces.map((p) =>
          getPlaceDetails(p.id).catch(() => null), // tolerate per-place failures
        ),
      )

      // 4. Build Clinic objects, filter by distance, sort.
      let results: Clinic[] = topPlaces
        .map((p, i) => toClinic(p, detailsList[i], geo.lat, geo.lng))
        .filter((c) => c.distanceMiles <= distance)
        .sort((a, b) => a.distanceMiles - b.distanceMiles)

      // 5. Apply local resource filtering (telehealth needs name-based filter).
      results = dedupeClinics(applyResourceFilter(results, filters))

      setClinics(results)
      setCurrentPage(1)
      setStatus(
        results.length
          ? `Showing ${results.length} support option${results.length === 1 ? '' : 's'} within ${distance} miles of ${geo.formatted}`
          : `No providers found within ${distance} miles. Try a larger distance or different location.`,
      )
    } catch (searchError) {
      const message = searchError instanceof Error ? searchError.message : 'Something went wrong. Please try again.'
      setError(message)
      setStatus('Search paused')
      setClinics([])
    } finally {
      setIsSearching(false)
    }
  }

  function toggleFilter(key: keyof ResourceFilters) {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleLocationChange(value: string) {
    setLocation(value)
    setSelectedAddress(null)
  }

  function chooseAddress(suggestion: AddressSuggestion) {
    setSelectedAddress(suggestion)
    setLocation(suggestion.formatted)
    setAddressSuggestions([])
    setError('')
  }

  function getValidDistance() {
    const parsedDistance = Number(distanceInput)
    if (!Number.isFinite(parsedDistance) || parsedDistance < 1) return null
    return Math.min(parsedDistance, 50)
  }

  function handleDistanceBlur() {
    const distance = getValidDistance()
    setDistanceInput(distance === null ? '1' : String(distance))
    setCurrentPage(1)
  }

  function goToPage(page: number) {
    setCurrentPage(Math.min(Math.max(page, 1), totalPages))
  }

  const totalPages = Math.max(1, Math.ceil(clinics.length / resultsPerPage))
  const pageStart = (currentPage - 1) * resultsPerPage
  const visibleClinics = clinics.slice(pageStart, pageStart + resultsPerPage)
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)

  return (
    <div className="page-shell">
      <header className="site-header" aria-label="Main navigation">
        <a className="brand" href="#" aria-label="ReachOut home">
          <span className="brand-mark" aria-hidden="true">RO</span>
          <span>ReachOut</span>
        </a>
        <a className="lifeline-link" href="tel:988" aria-label="Call the 988 Lifeline">
          988 Lifeline
        </a>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">Local mental health support</p>
          <h1 id="hero-title">Need Support Nearby?</h1>
        </section>

        <section className="crisis-banner" aria-label="Immediate crisis support">
          <div>
            <p className="crisis-title">Need immediate help?</p>
            <p>
              Call or text <strong>988</strong> for free, confidential crisis support available 24/7.
            </p>
          </div>
          <a href="tel:988" className="crisis-button">Call 988</a>
        </section>

        <section className="search-panel" aria-label="Find nearby care">
          <form className="search-form" onSubmit={handleSearch}>
            <label className="sr-only" htmlFor="locationInput">Enter city, ZIP, or address</label>
            <div className="search-field">
              <input
                id="locationInput"
                type="search"
                placeholder="Enter city, ZIP, exact address, or building"
                autoComplete="off"
                value={location}
                onChange={(event) => handleLocationChange(event.target.value)}
                onFocus={() => {
                  if (addressSuggestions.length) setAddressSuggestions(addressSuggestions)
                }}
              />

              {(addressSuggestions.length > 0 || isSuggesting) && (
                <div className="address-suggestions" role="listbox" aria-label="Confirmed USA address suggestions">
                  {isSuggesting && <p className="suggestion-status">Checking addresses...</p>}
                  {addressSuggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion.id}
                      onClick={() => chooseAddress(suggestion)}
                      role="option"
                    >
                      {suggestion.formatted}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="submit" disabled={isSearching}>
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </form>

          <div className="results-layout">
            <aside className="filters" aria-label="Filters">
              <button
                className="filter-toggle"
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <span>Filters</span>
                <span aria-hidden="true">v</span>
              </button>

              {filtersOpen && (
                <div className="filter-menu">
                  <fieldset>
                    <legend>Distance</legend>
                    <label className="distance-control" htmlFor="distanceInput">
                      <span>Within</span>
                      <input
                        id="distanceInput"
                        type="number"
                        min="1"
                        max="50"
                        value={distanceInput}
                        onChange={(event) => {
                          setDistanceInput(event.target.value)
                          setCurrentPage(1)
                        }}
                        onBlur={handleDistanceBlur}
                      />
                      <span>miles</span>
                    </label>
                  </fieldset>

                  <fieldset>
                    <legend>Resources</legend>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.therapy}
                        onChange={() => toggleFilter('therapy')}
                      /> Therapy
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.psychiatry}
                        onChange={() => toggleFilter('psychiatry')}
                      /> Psychiatry
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={filters.telehealth}
                        onChange={() => toggleFilter('telehealth')}
                      /> Telehealth
                    </label>
                  </fieldset>
                </div>
              )}
            </aside>

            <section className="results" aria-live="polite">
              <p className="status-line">{status}</p>
              {error && <p className="error-line">{error}</p>}

              <div className="clinic-list">
                {visibleClinics.length ? (
                  visibleClinics.map((clinic) => <ClinicCard clinic={clinic} key={clinic.id} />)
                ) : (
                  <div className="empty-state">
                    Try a larger distance, a broader location, or different filters.
                  </div>
                )}
              </div>

              {clinics.length > resultsPerPage && (
                <nav className="pagination" aria-label="Results pages">
                  <button
                    className="page-arrow"
                    type="button"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                  >
                    &lt;
                  </button>
                  <div className="page-buttons">
                    {pageNumbers.map((page) => (
                      <button
                        className={page === currentPage ? 'page-button is-active' : 'page-button'}
                        type="button"
                        key={page}
                        onClick={() => goToPage(page)}
                        aria-current={page === currentPage ? 'page' : undefined}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                  <button
                    className="page-arrow"
                    type="button"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    aria-label="Next page"
                  >
                    &gt;
                  </button>
                </nav>
              )}

              <p className="attribution">
                Provider data from Google Places when available, with OpenStreetMap backup results. Call providers to
                confirm services, hours, insurance, and availability.
              </p>
            </section>
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
