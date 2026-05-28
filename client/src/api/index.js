// Single source of truth for the API base URL.
// Import this instead of repeating the env-var fallback in every component.
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';

export default API_BASE;
