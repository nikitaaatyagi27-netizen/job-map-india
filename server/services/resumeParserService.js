const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { callLLM } = require('../utils/groqClient');

async function extractTextFromBuffer(buffer, mimetype) {
  if (mimetype === 'application/pdf') {
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimetype === 'application/msword'
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  return buffer.toString('utf-8');
}

async function extractSkillsWithLLM(resumeText) {
  const prompt = `You are an expert technical recruiter and resume analyst.

Read this resume carefully — pay close attention to the PROJECTS and WORK EXPERIENCE sections to understand what this person has actually built and where they have worked. The skills section alone is misleading because everyone lists Python/JavaScript.

Return ONLY a JSON object in this exact format, nothing else:
{
  "domain": "arvr",
  "suggestedRoles": [
    "AR/VR Developer",
    "Unity Developer (XR / 3D focus)",
    "XR Engineer",
    "Game Developer (Unity / Unreal)",
    "Simulation Engineer",
    "WebXR Developer",
    "Mobile AR Developer (ARCore / ARKit)",
    "Graphics Programmer",
    "Spatial Computing Engineer"
  ],
  "primarySkills": ["Unity3D", "ARCore", "ARKit", "WebXR", "OpenXR", "Blender", "HLSL"],
  "secondarySkills": ["Python", "JavaScript", "C#", "C++"],
  "experienceYears": 3,
  "summary": "AR/VR developer with 3+ years building immersive XR apps using Unity and ARCore"
}

Rules:
- domain: ONE of: arvr, security, ml, devops, blockchain, data, mobile, embedded, web, backend, fullstack, gamedev, cloud, other
- suggestedRoles: 8-15 specific job titles this person should actually apply for, based on what they BUILT in projects and WHERE they worked — not just the skills list. Be specific (e.g. "Unity Developer" not just "Developer"). Include variations recruiters actually post.
- primarySkills: domain-specific tools and frameworks that define their specialty — inferred from projects and experience. These are what a hiring manager looks for in a JD. Max 15.
- secondarySkills: general-purpose languages/tools used across all domains (Python, JavaScript, Java, C++, SQL, HTML, CSS, Git, Linux). Max 10.
- experienceYears: total professional experience as a number
- summary: one sentence on their core specialty

CRITICAL RULES:
1. A person who uses Python inside Unity scripts is NOT a Python Developer — do NOT include "Python Developer" in suggestedRoles
2. A person who uses JavaScript for Three.js/WebXR is NOT a Full Stack Developer
3. Look at PROJECT NAMES and DESCRIPTIONS to determine the real domain
4. suggestedRoles must reflect what they have BUILT, not what languages they listed

Resume:
${resumeText.slice(0, 6000)}`;

  let raw;
  try {
    raw = await callLLM([{ role: 'user', content: prompt }], { temperature: 0, max_tokens: 800 });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 429) {
      throw new Error('Resume parsing rate-limited — please wait 30 seconds and try again');
    }
    if (status === 504 || status === 502 || !status) {
      console.warn('[RESUME PARSER] LLM timeout, retrying in 3s...');
      await new Promise(r => setTimeout(r, 3000));
      raw = await callLLM([{ role: 'user', content: prompt }], { temperature: 0, max_tokens: 800 });
    } else {
      throw err;
    }
  }
  const stripped = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const match = stripped.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('LLM did not return valid JSON');

  const parsed = JSON.parse(match[0]);

  const primarySkills = parsed.primarySkills || [];
  const secondarySkills = parsed.secondarySkills || [];
  const suggestedRoles = parsed.suggestedRoles || [];

  return {
    domain: parsed.domain || 'other',
    suggestedRoles,
    primarySkills,
    secondarySkills,
    skills: [...new Set([...primarySkills, ...secondarySkills])],
    roles: suggestedRoles,  // backward compat — roles is now the same as suggestedRoles
    experienceYears: parsed.experienceYears || 0,
    summary: parsed.summary || ''
  };
}

async function parseResume(buffer, mimetype) {
  const text = await extractTextFromBuffer(buffer, mimetype);
  if (!text || text.trim().length < 50) {
    throw new Error('Could not extract enough text from resume');
  }
  return extractSkillsWithLLM(text);
}

module.exports = { parseResume };
