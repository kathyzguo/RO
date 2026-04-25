/**
 * api/anthropic.js
 * Wrapper for the Anthropic Claude API — powers the AI triage assistant.
 * The triage assistant helps users figure out what KIND of provider they need
 * before searching, e.g. "I need someone for anxiety who takes Medicaid" →
 * suggests searching for "therapist + sliding scale"
 */

const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY

const SYSTEM_PROMPT = `You are a compassionate mental health resource guide called MindBridge Assistant. 
Your role is to help people find the RIGHT type of mental health support for their situation.

You do NOT provide therapy, diagnosis, or medical advice. You help people understand:
- What type of provider they might benefit from (therapist, psychiatrist, counselor, support group, crisis center)
- What questions to ask when calling a provider
- What to expect from their first appointment
- How to navigate insurance/cost concerns

Always be warm, non-judgmental, and validating. Mental health help-seeking is brave.

At the end of your response, if appropriate, suggest ONE of these search filters the user should apply:
[SUGGEST_FILTER: therapist] or [SUGGEST_FILTER: psychiatrist] or [SUGGEST_FILTER: crisis] or [SUGGEST_FILTER: support_group] or [SUGGEST_FILTER: rehab]

If the person seems to be in crisis or mentions self-harm/suicide, ALWAYS lead with:
"If you're in immediate danger, please call or text 988 (Suicide & Crisis Lifeline) right now."

Keep responses concise — 3–5 sentences max unless the person asks for more detail.
Do not use clinical jargon. Be human.`

/**
 * Send a message to the triage assistant and get a response
 * @param {Array<{role: 'user'|'assistant', content: string}>} messages - conversation history
 * @returns {Promise<{text: string, suggestedFilter: string|null}>}
 */
export async function sendTriageMessage(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `Anthropic API error: ${res.status}`)
  }

  const data = await res.json()
  const rawText = data.content?.[0]?.text || ''

  // Extract optional filter suggestion from response
  const filterMatch = rawText.match(/\[SUGGEST_FILTER:\s*(\w+)\]/)
  const suggestedFilter = filterMatch ? filterMatch[1] : null
  const text = rawText.replace(/\[SUGGEST_FILTER:[^\]]+\]/g, '').trim()

  return { text, suggestedFilter }
}

/**
 * Generate a concise summary label for a provider to help users decide quickly
 * e.g. "Great for anxiety • Sliding scale available • Usually responds in 1 day"
 * This is a nice-to-have — only call this if you have time to spare.
 * @param {Object} place - normalized place object
 * @returns {Promise<string>}
 */
export async function generateProviderSummary(place) {
  const prompt = `Given this mental health provider listing, write ONE short sentence (max 15 words) 
highlighting the most useful thing for someone deciding whether to call them.
Be specific and practical. No fluff.

Provider: ${place.name}
Types: ${place.types?.join(', ')}
Rating: ${place.rating}/5 (${place.reviewCount} reviews)
Price level: ${place.priceLevel ?? 'unknown'}
Open now: ${place.openNow ?? 'unknown'}

Respond with just the one sentence, nothing else.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 60,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) return null
  const data = await res.json()
  return data.content?.[0]?.text?.trim() || null
}
