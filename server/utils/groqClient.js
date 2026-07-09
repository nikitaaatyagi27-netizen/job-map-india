const axios = require("axios");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const GEMINI_CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-2.0-flash";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";

function isRateLimitError(error) {
  const status = error?.response?.status;
  const message = error?.response?.data?.error?.message || error?.message || "";
  if (status === 429 || status === 402) return true;
  return /quota|rate limit|resource exhausted|too many requests|credits|payment required/i.test(message);
}

// ── Groq (OpenAI-compatible) ──────────────────────────────────────────────────
async function callGroq(messages, temperature, max_tokens) {
  const res = await axios.post(
    GROQ_URL,
    { model: GROQ_MODEL, messages, temperature, max_tokens },
    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
  );
  return res.data?.choices?.[0]?.message?.content?.trim() || "";
}

// ── Gemini (different request shape — convert messages) ───────────────────────
async function callGemini(messages, temperature, max_tokens) {
  // Merge any system messages into the first user turn (Gemini has no system role
  // in this endpoint) and map roles: assistant → model, user → user.
  const systemText = messages.filter(m => m.role === "system").map(m => m.content).join("\n");
  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
  if (systemText && contents.length && contents[0].role === "user") {
    contents[0].parts[0].text = `${systemText}\n\n${contents[0].parts[0].text}`;
  }

  const url = `${GEMINI_BASE}/models/${GEMINI_CHAT_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const res = await axios.post(
    url,
    { contents, generationConfig: { temperature, maxOutputTokens: max_tokens } },
    { headers: { "Content-Type": "application/json" }, timeout: 30000 }
  );
  return res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

// ── OpenRouter (OpenAI-compatible) ────────────────────────────────────────────
async function callOpenRouter(messages, temperature, max_tokens) {
  const res = await axios.post(
    OPENROUTER_URL,
    { model: OPENROUTER_MODEL, messages, temperature, max_tokens },
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" }, timeout: 30000 }
  );
  return res.data?.choices?.[0]?.message?.content?.trim() || "";
}

/**
 * Call an LLM with automatic provider fallback. Order:
 *   Groq (fast) → Gemini → OpenRouter
 * Groq and Gemini fail in opposite ways (Groq = per-minute bursts, Gemini =
 * per-day cap), so they cover each other. OpenRouter is the last resort.
 *
 * @param {Array} messages  - OpenAI-style messages array
 * @param {Object} options  - { temperature, max_tokens }
 * @returns {string}        - raw text content from the model
 */
async function callLLM(messages, { temperature = 0.1, max_tokens = 800 } = {}) {
  const providers = [
    { name: "Groq", key: process.env.GROQ_API_KEY, fn: callGroq },
    { name: "Gemini", key: process.env.GEMINI_API_KEY, fn: callGemini },
    { name: "OpenRouter", key: process.env.OPENROUTER_API_KEY, fn: callOpenRouter }
  ].filter(p => p.key);

  if (!providers.length) {
    throw new Error("No LLM API key available (set GROQ_API_KEY, GEMINI_API_KEY, or OPENROUTER_API_KEY)");
  }

  let lastErr;
  let allRateLimited = true;
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i];
    // One retry with a short backoff on a rate-limit before falling to the next
    // provider — clears transient per-minute throttles without giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await p.fn(messages, temperature, max_tokens);
      } catch (err) {
        lastErr = err;
        if (!isRateLimitError(err)) allRateLimited = false;
        if (attempt === 0 && isRateLimitError(err)) {
          await new Promise(r => setTimeout(r, 8000));
          continue; // retry same provider once
        }
        const next = providers[i + 1]?.name;
        const why = isRateLimitError(err) ? "rate-limited/quota" : (err?.response?.status || err?.message);
        console.warn(`[LLM] ${p.name} failed (${why})${next ? ` — falling back to ${next}` : ""}`);
        break; // move to next provider
      }
    }
  }
  // If every provider was rate-limited/quota-exhausted, flag it so batch callers
  // can stop early instead of hammering exhausted APIs for every remaining item.
  const finalErr = lastErr || new Error("All LLM providers failed");
  if (allRateLimited) finalErr.allProvidersExhausted = true;
  throw finalErr;
}

module.exports = { callLLM };
