import { detectSkills } from '@/lib/ai/taxonomy';
import type { CandidateAnalysis, JobAnalysis } from '@/lib/schemas/ai';
import type { Importance, Requirement, Seniority, SkillCategory } from '@/lib/schemas/domain';

/**
 * Offline CV and job-description analysis.
 *
 * Section-aware parsing plus the curated taxonomy. It extracts what is
 * demonstrably in the text and states nothing beyond it — where an LLM would
 * infer, this returns null.
 */

type Section = 'summary' | 'experience' | 'education' | 'skills' | 'projects' | 'certifications' | 'other';

const SECTION_PATTERNS: Array<[Section, RegExp]> = [
  ['experience', /^(work\s+)?(professional\s+)?experience|employment|career history$/i],
  ['education', /^education|academic( background)?|qualifications$/i],
  ['skills', /^(technical\s+)?skills|technologies|tech stack|competencies$/i],
  ['projects', /^projects?|portfolio|selected work$/i],
  ['certifications', /^certifications?|licenses|courses$/i],
  ['summary', /^(professional\s+)?summary|profile|objective|about( me)?$/i],
];

interface ParsedSections {
  order: Array<{ section: Section; lines: string[] }>;
  byName: Record<Section, string[]>;
}

/** Split a CV into labelled sections by detecting heading lines. */
export function splitSections(rawText: string): ParsedSections {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim());
  const order: Array<{ section: Section; lines: string[] }> = [];
  const byName: Record<Section, string[]> = {
    summary: [], experience: [], education: [], skills: [],
    projects: [], certifications: [], other: [],
  };

  let current: Section = 'other';
  let bucket: string[] = [];

  const flush = (): void => {
    if (bucket.length) {
      order.push({ section: current, lines: bucket });
      byName[current].push(...bucket);
    }
    bucket = [];
  };

  for (const line of lines) {
    // A heading is short, mostly letters, and matches a known section name.
    const candidate = line.replace(/[^a-zA-Z\s]/g, '').trim();
    const isHeading =
      candidate.length > 0 &&
      candidate.length <= 40 &&
      SECTION_PATTERNS.some(([, pattern]) => pattern.test(candidate));

    if (isHeading) {
      flush();
      const match = SECTION_PATTERNS.find(([, pattern]) => pattern.test(candidate));
      current = match ? match[0] : 'other';
      continue;
    }
    if (line) bucket.push(line);
  }
  flush();

  return { order, byName };
}

const BULLET = /^[-•*◦·▪]\s*/;

/** Lines that read as an achievement: an action verb and some substance. */
const ACHIEVEMENT_LINE =
  /\b(built|designed|implemented|developed|created|led|managed|migrated|optimi[sz]ed|automated|deployed|reduced|improved|delivered|launched|owned|architected|wrote|scaled|integrated)\b/i;

/**
 * Extract achievement lines from a section.
 *
 * Bullet glyphs frequently do not survive PDF text extraction, so a CV that
 * clearly has bullets on screen can arrive here as plain lines. When no bullet
 * markers are found at all, fall back to lines that read as achievements —
 * otherwise those CVs yield no probe targets and the interview loses its best
 * material.
 */
function bullets(lines: string[]): string[] {
  const marked = lines
    .filter((line) => BULLET.test(line) || /^\d+[.)]\s/.test(line))
    .map((line) => line.replace(BULLET, '').replace(/^\d+[.)]\s*/, '').trim())
    .filter((line) => line.length > 12);

  if (marked.length > 0) return marked;

  return lines
    .filter((line) => line.length > 24 && ACHIEVEMENT_LINE.test(line) && !/\b(19|20)\d{2}\b/.test(line))
    .map((line) => line.trim());
}

/** Years mentioned as a range, used to estimate total experience. */
function extractYearSpans(text: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const currentYear = new Date().getFullYear();
  const pattern = /(\b(19|20)\d{2}\b)\s*(?:-|–|—|to|until)\s*(\b(19|20)\d{2}\b|present|current|now)/gi;

  for (const match of text.matchAll(pattern)) {
    const start = Number.parseInt(match[1] ?? '', 10);
    const endRaw = match[3] ?? '';
    const end = /present|current|now/i.test(endRaw) ? currentYear : Number.parseInt(endRaw, 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end <= currentYear + 1) {
      spans.push([start, end]);
    }
  }
  return spans;
}

/** Total distinct years covered by the spans, so overlapping roles count once. */
function totalYears(spans: Array<[number, number]>): number | null {
  if (spans.length === 0) return null;
  const years = new Set<number>();
  for (const [start, end] of spans) {
    for (let y = start; y < end; y += 1) years.add(y);
  }
  return years.size || null;
}

function inferSeniority(years: number | null, text: string): Seniority | null {
  const lower = text.toLowerCase();
  if (/\bprincipal\b|\bdistinguished\b|\bstaff engineer\b/.test(lower)) return 'principal';
  // "lead" must appear as a title, not as the verb in "lead the migration".
  if (/\b(tech(nical)?\s+lead|team\s+lead|lead\s+(engineer|developer|scientist|analyst|architect|designer)|head\s+of\s+\w+|engineering\s+manager)\b/.test(lower)) {
    return 'lead';
  }
  if (/\bsenior\b|\bsr\.?\b/.test(lower)) return 'senior';
  if (/\bintern(ship)?\b|\btrainee\b/.test(lower)) return 'intern';
  if (/\bjunior\b|\bjr\.?\b|\bgraduate\b|\bentry[- ]level\b/.test(lower)) return 'junior';
  if (years === null) return null;
  if (years >= 10) return 'lead';
  if (years >= 6) return 'senior';
  if (years >= 3) return 'mid';
  if (years >= 1) return 'junior';
  return 'intern';
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const URL = /\bhttps?:\/\/[^\s)]+|\b(?:www\.|github\.com\/|linkedin\.com\/)[^\s)]+/i;

/** Best-effort name detection: the first short line that is not contact detail. */
function extractName(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    if (!line || line.length > 60) continue;
    if (EMAIL.test(line) || URL.test(line) || /\d{4}/.test(line)) continue;
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    // Names are title case or upper case, and contain no sentence punctuation.
    if (/[.,;:|]/.test(line)) continue;
    if (words.every((w) => /^[A-Z][a-zA-Z'-]*$/.test(w) || /^[A-Z'-]+$/.test(w))) {
      return line;
    }
  }
  return null;
}

export function analyzeResumeOffline(rawText: string): CandidateAnalysis {
  const sections = splitSections(rawText);
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Year spans are read from the experience section alone. Counting the whole
  // document would fold a four-year degree into professional experience.
  const experienceText = sections.byName.experience.join('\n');
  const years = totalYears(extractYearSpans(experienceText || rawText));
  const seniority = inferSeniority(years, rawText);

  // Skills are read from the whole document, but a mention inside the SKILLS
  // section is a stronger claim than one buried in a bullet.
  const skillSectionText = sections.byName.skills.join(' ');
  const declaredKeys = new Set(detectSkills(skillSectionText).map((s) => s.key));

  const skills = detectSkills(rawText).map((skill) => {
    const declared = declaredKeys.has(skill.key);
    const context = lines.find((line) =>
      line.toLowerCase().includes(skill.label.toLowerCase()) && line.length > 30,
    );
    return {
      label: skill.label,
      category: skill.category,
      // The offline engine will not invent a proficiency level. Listing a skill
      // in a skills section is a claim of use, nothing more.
      claimedLevel: null,
      yearsUsed: null,
      evidence: declared ? null : (context ?? null),
    };
  });

  const experienceBullets = bullets(sections.byName.experience);
  const projectBullets = bullets(sections.byName.projects);

  const experiences = buildExperiences(sections.byName.experience);
  const projects = buildProjects(sections.byName.projects);

  // Claims worth probing: bullets that name a technology AND describe an action.
  const probeTargets = [...experienceBullets, ...projectBullets]
    .filter((bullet) => detectSkills(bullet).length > 0 && /\b(built|designed|implemented|developed|created|led|migrated|optimi[sz]ed|automated|deployed|reduced|improved)\b/i.test(bullet))
    .slice(0, 8)
    .map((claim) => {
      const skill = detectSkills(claim)[0];
      return {
        claim: claim.slice(0, 300),
        skillLabel: skill?.label ?? 'General',
        whyItMatters: 'Stated first-hand delivery — worth testing whether the underlying decisions are understood.',
      };
    });

  const redFlags: string[] = [];
  if (rawText.length < 400) redFlags.push('The CV is very short, leaving little to verify in the interview.');
  if (skills.length === 0) redFlags.push('No recognisable skills or technologies are named.');
  if (experiences.length === 0 && projects.length === 0) {
    redFlags.push('No structured work history or projects could be identified.');
  }
  if (years === null) redFlags.push('No dates are given, so total experience cannot be established.');

  const summaryText = sections.byName.summary.join(' ').trim();

  return {
    fullName: extractName(lines),
    headline: deriveHeadline(lines, sections),
    location: null,
    totalYearsExperience: years,
    seniority,
    summary:
      summaryText.slice(0, 1200) ||
      `Offline analysis identified ${skills.length} skill${skills.length === 1 ? '' : 's'}, ` +
        `${experiences.length} role${experiences.length === 1 ? '' : 's'} and ` +
        `${projects.length} project${projects.length === 1 ? '' : 's'} in this CV.`,
    skills: skills.slice(0, 60),
    experiences: experiences.slice(0, 20),
    projects: projects.slice(0, 20),
    education: buildEducation(sections.byName.education).slice(0, 10),
    certifications: sections.byName.certifications
      .filter((line) => line.length > 4)
      .slice(0, 15)
      .map((line) => ({ name: line.slice(0, 200), issuer: null, issuedAt: null })),
    achievements: experienceBullets
      .filter((bullet) => /\d/.test(bullet))
      .slice(0, 12)
      .map((bullet) => bullet.slice(0, 300)),
    probeTargets,
    redFlags: redFlags.slice(0, 8),
  };
}

function deriveHeadline(lines: string[], sections: ParsedSections): string | null {
  const summaryFirst = sections.byName.summary[0];
  if (summaryFirst && summaryFirst.length <= 120) return summaryFirst;
  // Otherwise the line after the name is usually the title.
  const candidate = lines.slice(1, 4).find((line) => line.length > 3 && line.length <= 80 && !EMAIL.test(line) && !URL.test(line));
  return candidate ?? null;
}

function buildExperiences(lines: string[]): CandidateAnalysis['experiences'] {
  const entries: CandidateAnalysis['experiences'] = [];
  let current: CandidateAnalysis['experiences'][number] | null = null;

  for (const line of lines) {
    const isBullet = BULLET.test(line) || /^\d+[.)]\s/.test(line);
    const hasDates = /\b(19|20)\d{2}\b/.test(line);

    if (!isBullet && hasDates && line.length < 160) {
      if (current) entries.push(current);
      const [left, right] = splitTitleCompany(line);
      const dates = line.match(/\b((19|20)\d{2})\b/g) ?? [];
      current = {
        company: right,
        title: left,
        startDate: dates[0] ?? null,
        endDate: /present|current|now/i.test(line) ? null : (dates[1] ?? null),
        isCurrent: /present|current|now/i.test(line),
        summary: null,
        achievements: [],
        technologies: [],
      };
      continue;
    }

    // Same fallback as `bullets`: treat an achievement-shaped line as a bullet
    // when the glyphs did not survive extraction.
    if (current && (isBullet || (line.length > 24 && ACHIEVEMENT_LINE.test(line)))) {
      const text = line.replace(BULLET, '').replace(/^\d+[.)]\s*/, '').trim();
      if (text.length > 12 && current.achievements.length < 8) {
        current.achievements.push(text.slice(0, 400));
      }
      for (const skill of detectSkills(text)) {
        if (current.technologies.length < 20 && !current.technologies.includes(skill.label)) {
          current.technologies.push(skill.label);
        }
      }
    }
  }
  if (current) entries.push(current);
  return entries;
}

/** "Senior Engineer — Acme Corp, 2021-2024" → ["Senior Engineer", "Acme Corp"]. */
function splitTitleCompany(line: string): [string | null, string | null] {
  const withoutDates = line.replace(/[,|]?\s*\b(19|20)\d{2}\b.*$/, '').trim();
  const parts = withoutDates.split(/\s+[-–—|@]\s+|\s+at\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return [parts[0]?.slice(0, 160) ?? null, parts[1]?.slice(0, 160) ?? null];
  return [withoutDates.slice(0, 160) || null, null];
}

function buildProjects(lines: string[]): CandidateAnalysis['projects'] {
  const projects: CandidateAnalysis['projects'] = [];
  let current: CandidateAnalysis['projects'][number] | null = null;

  for (const line of lines) {
    const isBullet = BULLET.test(line) || /^\d+[.)]\s/.test(line);
    if (!isBullet && line.length <= 120) {
      if (current) projects.push(current);
      current = {
        name: line.replace(/[:–—-]\s*$/, '').slice(0, 160),
        description: null,
        technologies: detectSkills(line).map((s) => s.label).slice(0, 20),
        outcomes: null,
        url: line.match(URL)?.[0]?.slice(0, 300) ?? null,
      };
      continue;
    }
    if (current) {
      const text = line.replace(BULLET, '').trim();
      current.description = ((current.description ? `${current.description} ` : '') + text).slice(0, 1200);
      for (const skill of detectSkills(text)) {
        if (current.technologies.length < 20 && !current.technologies.includes(skill.label)) {
          current.technologies.push(skill.label);
        }
      }
    }
  }
  if (current) projects.push(current);
  return projects;
}

function buildEducation(lines: string[]): CandidateAnalysis['education'] {
  const degreePattern = /\b(b\.?sc|b\.?a|b\.?eng|m\.?sc|m\.?a|m\.?eng|mba|ph\.?d|bachelor|master|doctorate|diploma|associate)\b/i;
  return lines
    .filter((line) => line.length > 6)
    .map((line) => {
      const dates = line.match(/\b((19|20)\d{2})\b/g) ?? [];
      const degreeMatch = line.match(degreePattern);
      return {
        institution: extractInstitution(line),
        degree: degreeMatch ? degreeMatch[0].slice(0, 160) : null,
        field: extractField(line),
        startDate: dates[0] ?? null,
        endDate: dates[1] ?? null,
        grade: line.match(/\b(first class|2:1|2:2|gpa\s*[\d.]+|distinction|merit)\b/i)?.[0] ?? null,
      };
    })
    .filter((entry) => entry.institution || entry.degree);
}

/**
 * Pull the institution out of a line that may also carry the degree.
 *
 * "BSc in Computer Science - University of Valencia, 2014" has both; only the
 * segment naming an institution belongs in this field.
 */
function extractInstitution(line: string): string | null {
  const institutionWords = /\b(university|college|institute|school|academy|polytechnic)\b/i;
  if (!institutionWords.test(line)) return null;

  const cleaned = line.replace(/\b((19|20)\d{2})\b/g, '').trim();
  const segment =
    cleaned
      .split(/\s+[-–—|]\s+|,\s*/)
      .map((part) => part.trim())
      .find((part) => institutionWords.test(part)) ?? cleaned;

  return segment.replace(/[,–—-]\s*$/, '').trim().slice(0, 200) || null;
}

function extractField(line: string): string | null {
  const match = line.match(/\bin\s+([A-Z][\w\s&]{2,50})/);
  return match?.[1]?.trim().slice(0, 160) ?? null;
}

// ── Job description ────────────────────────────────────────────────────────

const REQUIRED_CUES = /\b(required|requirements?|must have|essential|you (will )?(need|have)|minimum|mandatory)\b/i;
const PREFERRED_CUES = /\b(preferred|nice to have|bonus|plus|desirable|advantageous|good to have)\b/i;

export function analyzeJobOffline(description: string, titleHint?: string): JobAnalysis {
  const lines = description.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lower = description.toLowerCase();

  // Track the requirement level as we walk the document: a "Nice to have"
  // heading applies to the bullets beneath it.
  let mode: Requirement = 'required';
  const skillRequirement = new Map<string, Requirement>();
  const skillEvidence = new Map<string, string>();

  for (const line of lines) {
    if (PREFERRED_CUES.test(line) && line.length < 80) mode = 'preferred';
    else if (REQUIRED_CUES.test(line) && line.length < 80) mode = 'required';

    const lineMode: Requirement = PREFERRED_CUES.test(line) ? 'preferred' : mode;
    for (const skill of detectSkills(line)) {
      // "Required" always wins over a later "preferred" mention.
      const existing = skillRequirement.get(skill.key);
      if (existing !== 'required') skillRequirement.set(skill.key, lineMode);
      if (!skillEvidence.has(skill.key)) skillEvidence.set(skill.key, line.slice(0, 300));
    }
  }

  const detected = detectSkills(description);
  const mentionCount = (label: string): number =>
    (lower.match(new RegExp(`\\b${label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;

  const skills = detected.map((skill) => {
    const requirement = skillRequirement.get(skill.key) ?? 'required';
    const mentions = mentionCount(skill.label);
    const importance: Importance =
      requirement === 'required' && mentions >= 3 ? 'critical'
      : requirement === 'required' ? 'high'
      : requirement === 'preferred' ? 'medium'
      : 'low';
    return {
      label: skill.label,
      category: skill.category as SkillCategory,
      requirement,
      importance,
      evidence: skillEvidence.get(skill.key) ?? null,
    };
  });

  // A job with no recognisable skill still needs one row so the planner has
  // something to work from.
  if (skills.length === 0) {
    skills.push({
      label: titleHint ?? 'General Role Knowledge',
      category: 'domain',
      requirement: 'required',
      importance: 'high',
      evidence: null,
    });
  }

  const responsibilities = bullets(lines)
    .filter((bullet) => /\b(you will|responsible|own|build|develop|design|manage|lead|deliver|collaborate|maintain|support|drive)\b/i.test(bullet))
    .slice(0, 15)
    .map((bullet) => bullet.slice(0, 300));

  const yearsMatch = description.match(/(\d+)\s*(?:\+|to|-|–)?\s*(\d+)?\s*years?/i);

  return {
    title: (titleHint ?? deriveJobTitle(lines) ?? 'Role').slice(0, 160),
    company: null,
    location: null,
    employmentType: /\b(full[- ]time|part[- ]time|contract|internship|freelance)\b/i.exec(description)?.[0] ?? null,
    seniority: inferSeniority(null, description),
    experienceYears: {
      min: yearsMatch?.[1] ? Number.parseInt(yearsMatch[1], 10) : null,
      max: yearsMatch?.[2] ? Number.parseInt(yearsMatch[2], 10) : null,
    },
    summary: lines.slice(0, 3).join(' ').slice(0, 1200) || 'No summary could be extracted from this posting.',
    responsibilities,
    skills: skills.slice(0, 40),
    technicalRequirements: bullets(lines)
      .filter((bullet) => detectSkills(bullet).length > 0)
      .slice(0, 15)
      .map((bullet) => bullet.slice(0, 300)),
    softSkills: skills.filter((s) => s.category === 'soft').map((s) => s.label).slice(0, 12),
    keywords: [...new Set(detected.map((s) => s.label))].slice(0, 25),
    interviewFocus: skills
      .filter((s) => s.importance === 'critical' || s.importance === 'high')
      .slice(0, 8)
      .map((s) => `Verify practical depth in ${s.label}.`),
  };
}

function deriveJobTitle(lines: string[]): string | null {
  const first = lines[0];
  if (first && first.length <= 100) return first.replace(/^(job title|role|position)\s*:\s*/i, '');
  return null;
}
