import API_BASE from '../api';

const SESSION_KEY = "jmi_session_id";

function generateId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getSessionId() {
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = generateId();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export async function loadSession(sessionId) {
  try {
    const res = await fetch(`${API_BASE}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function saveJobToSession(sessionId, jobData) {
  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/save-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jobData)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsaveJobFromSession(sessionId, applyLink) {
  try {
    const res = await fetch(`${API_BASE}/api/session/${sessionId}/save-job`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applyLink })
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function trackApplyClick(sessionId, jobData) {
  try {
    await Promise.all([
      fetch(`${API_BASE}/api/session/${sessionId}/apply-job`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobData)
      }),
      fetch(`${API_BASE}/api/jobs/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applyLink: jobData.applyLink, jobId: jobData.jobId })
      })
    ]);
  } catch {}
}
