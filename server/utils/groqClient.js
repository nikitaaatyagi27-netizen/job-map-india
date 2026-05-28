const axios = require("axios");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";

function isRateLimitError(error) {
  const status = error?.response?.status;
  const message = error?.response?.data?.error?.message || error?.message || "";
  if (status === 429 || status === 402) return true;
  return /quota|rate limit|resource exhausted|too many requests|credits|payment required/i.test(message);
}

/**
 * Call Groq first; fall back to OpenRouter on rate-limit or unavailability.
 * Both APIs are OpenAI-compatible so the request shape is identical.
 *
 * @param {Array} messages  - OpenAI-style messages array
 * @param {Object} options  - { temperature, max_tokens, systemPrompt }
 * @returns {string}        - raw text content from the model
 */
async function callLLM(messages, { temperature = 0.1, max_tokens = 800 } = {}) {
  const groqKey = process.env.GROQ_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (groqKey) {
    try {
      const res = await axios.post(
        GROQ_URL,
        { model: GROQ_MODEL, messages, temperature, max_tokens },
        {
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json"
          },
          timeout: 30000
        }
      );
      return res.data?.choices?.[0]?.message?.content?.trim() || "";
    } catch (err) {
      if (isRateLimitError(err)) {
        console.warn("[LLM] Groq rate-limited — falling back to OpenRouter");
      } else {
        console.warn("[LLM] Groq error, falling back to OpenRouter:", err?.response?.status || err?.message);
      }
    }
  }

  if (!openrouterKey) {
    throw new Error("No LLM API key available (set GROQ_API_KEY or OPENROUTER_API_KEY)");
  }

  const res = await axios.post(
    OPENROUTER_URL,
    { model: OPENROUTER_MODEL, messages, temperature, max_tokens },
    {
      headers: {
        Authorization: `Bearer ${openrouterKey}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );
  return res.data?.choices?.[0]?.message?.content?.trim() || "";
}

module.exports = { callLLM };
