import { toSkillKey, type SkillCategory } from '@/lib/schemas/domain';

/**
 * Curated skill taxonomy.
 *
 * Used to normalise skill names coming out of CVs and job descriptions so that
 * "JS", "Javascript" and "ECMAScript" all land on one row in the skill matrix.
 * The LLM path benefits from it too: model output is mapped through here before
 * being written, which keeps analytics from fragmenting across spellings.
 *
 * This is a matching aid, not an ontology — unknown skills pass through with
 * their normalised key rather than being discarded.
 */

export interface TaxonomyEntry {
  label: string;
  category: SkillCategory;
  aliases: readonly string[];
  /** Related skills used to suggest adjacent topics in learning plans. */
  related?: readonly string[];
}

export const SKILL_TAXONOMY: readonly TaxonomyEntry[] = [
  // ── Languages ────────────────────────────────────────────────────────────
  { label: 'Python', category: 'technical', aliases: ['python3', 'py'], related: ['Pandas', 'NumPy', 'Django'] },
  { label: 'JavaScript', category: 'technical', aliases: ['js', 'ecmascript', 'es6'], related: ['TypeScript', 'React', 'Node.js'] },
  { label: 'TypeScript', category: 'technical', aliases: ['ts'], related: ['JavaScript', 'React'] },
  { label: 'Java', category: 'technical', aliases: ['java se', 'java ee', 'j2ee'], related: ['Spring', 'Kotlin'] },
  { label: 'C#', category: 'technical', aliases: ['csharp', 'c sharp', 'dotnet c#'], related: ['.NET'] },
  { label: 'C++', category: 'technical', aliases: ['cpp', 'c plus plus'] },
  { label: 'Go', category: 'technical', aliases: ['golang'] },
  { label: 'Rust', category: 'technical', aliases: [] },
  { label: 'Ruby', category: 'technical', aliases: ['ruby on rails', 'rails'] },
  { label: 'PHP', category: 'technical', aliases: ['laravel'] },
  { label: 'Scala', category: 'technical', aliases: [] },
  { label: 'Kotlin', category: 'technical', aliases: [] },
  { label: 'Swift', category: 'technical', aliases: [] },
  { label: 'R', category: 'technical', aliases: ['r language'] },
  { label: 'SQL', category: 'technical', aliases: ['t sql', 'tsql', 'plsql', 'pl sql', 'ansi sql'], related: ['PostgreSQL', 'Data Modeling'] },

  // ── Data and databases ───────────────────────────────────────────────────
  { label: 'PostgreSQL', category: 'tool', aliases: ['postgres', 'psql'], related: ['SQL'] },
  { label: 'MySQL', category: 'tool', aliases: ['mariadb'], related: ['SQL'] },
  { label: 'MongoDB', category: 'tool', aliases: ['mongo'], related: ['NoSQL'] },
  { label: 'Redis', category: 'tool', aliases: [] },
  { label: 'Elasticsearch', category: 'tool', aliases: ['elastic search', 'opensearch'] },
  { label: 'Snowflake', category: 'tool', aliases: [] },
  { label: 'BigQuery', category: 'tool', aliases: ['google bigquery'] },
  { label: 'Redshift', category: 'tool', aliases: ['aws redshift'] },
  { label: 'Databricks', category: 'tool', aliases: [] },
  { label: 'NoSQL', category: 'domain', aliases: ['non relational'] },
  { label: 'Data Modeling', category: 'domain', aliases: ['data modelling', 'dimensional modeling', 'star schema'] },
  { label: 'Data Warehousing', category: 'domain', aliases: ['data warehouse', 'dwh'] },
  { label: 'ETL', category: 'domain', aliases: ['elt', 'data pipelines', 'data pipeline'], related: ['Airflow'] },
  { label: 'Airflow', category: 'tool', aliases: ['apache airflow'] },
  { label: 'Spark', category: 'tool', aliases: ['apache spark', 'pyspark'] },
  { label: 'Kafka', category: 'tool', aliases: ['apache kafka'] },
  { label: 'dbt', category: 'tool', aliases: ['data build tool'] },

  // ── Analytics and BI ─────────────────────────────────────────────────────
  { label: 'Power BI', category: 'tool', aliases: ['powerbi', 'power bi desktop', 'dax'] },
  { label: 'Tableau', category: 'tool', aliases: [] },
  { label: 'Looker', category: 'tool', aliases: ['looker studio'] },
  { label: 'Excel', category: 'tool', aliases: ['microsoft excel', 'advanced excel'] },
  { label: 'Statistics', category: 'domain', aliases: ['statistical analysis', 'hypothesis testing', 'ab testing', 'a b testing'] },

  // ── ML / AI ──────────────────────────────────────────────────────────────
  { label: 'Machine Learning', category: 'domain', aliases: ['ml', 'supervised learning', 'unsupervised learning'], related: ['Scikit-learn', 'Model Evaluation'] },
  { label: 'Deep Learning', category: 'domain', aliases: ['neural networks', 'dl'], related: ['PyTorch', 'TensorFlow'] },
  { label: 'Scikit-learn', category: 'tool', aliases: ['sklearn', 'scikit learn'], related: ['Machine Learning'] },
  { label: 'PyTorch', category: 'tool', aliases: ['torch'] },
  { label: 'TensorFlow', category: 'tool', aliases: ['tf', 'keras'] },
  { label: 'NLP', category: 'domain', aliases: ['natural language processing', 'text mining'] },
  { label: 'Computer Vision', category: 'domain', aliases: ['cv', 'opencv', 'image processing'] },
  { label: 'LLMs', category: 'domain', aliases: ['large language models', 'genai', 'generative ai', 'prompt engineering', 'rag'] },
  { label: 'Model Evaluation', category: 'domain', aliases: ['cross validation', 'model validation', 'precision recall'] },
  { label: 'Feature Engineering', category: 'domain', aliases: ['feature selection'] },
  { label: 'MLOps', category: 'domain', aliases: ['ml ops', 'model deployment'] },
  { label: 'Pandas', category: 'tool', aliases: [] },
  { label: 'NumPy', category: 'tool', aliases: ['numpy'] },

  // ── Web and app ──────────────────────────────────────────────────────────
  { label: 'React', category: 'tool', aliases: ['reactjs', 'react js'], related: ['JavaScript', 'Next.js'] },
  { label: 'Next.js', category: 'tool', aliases: ['nextjs'] },
  { label: 'Vue', category: 'tool', aliases: ['vuejs', 'vue js', 'nuxt'] },
  { label: 'Angular', category: 'tool', aliases: ['angularjs'] },
  { label: 'Node.js', category: 'tool', aliases: ['nodejs', 'node'] },
  { label: 'Django', category: 'tool', aliases: [] },
  { label: 'Flask', category: 'tool', aliases: ['fastapi'] },
  { label: 'Spring', category: 'tool', aliases: ['spring boot'] },
  { label: '.NET', category: 'tool', aliases: ['dotnet', 'asp.net', 'aspnet'] },
  { label: 'REST APIs', category: 'domain', aliases: ['rest', 'restful', 'api design'] },
  { label: 'GraphQL', category: 'tool', aliases: [] },
  { label: 'HTML/CSS', category: 'technical', aliases: ['html', 'css', 'scss', 'sass', 'tailwind'] },

  // ── Infrastructure ───────────────────────────────────────────────────────
  { label: 'AWS', category: 'tool', aliases: ['amazon web services', 'ec2', 's3', 'lambda'] },
  { label: 'Azure', category: 'tool', aliases: ['microsoft azure', 'azure devops'] },
  { label: 'GCP', category: 'tool', aliases: ['google cloud', 'google cloud platform'] },
  { label: 'Docker', category: 'tool', aliases: ['containers', 'containerization'] },
  { label: 'Kubernetes', category: 'tool', aliases: ['k8s'] },
  { label: 'Terraform', category: 'tool', aliases: ['infrastructure as code', 'iac'] },
  { label: 'CI/CD', category: 'domain', aliases: ['continuous integration', 'continuous delivery', 'github actions', 'jenkins', 'gitlab ci'] },
  { label: 'Linux', category: 'tool', aliases: ['unix', 'bash', 'shell scripting'] },
  { label: 'Git', category: 'tool', aliases: ['github', 'gitlab', 'version control'] },

  // ── Engineering practice ─────────────────────────────────────────────────
  { label: 'System Design', category: 'domain', aliases: ['distributed systems', 'architecture', 'scalability'] },
  { label: 'Data Structures', category: 'domain', aliases: ['dsa'] },
  { label: 'Algorithms', category: 'domain', aliases: ['algorithm design', 'complexity analysis', 'big o'] },
  { label: 'Testing', category: 'domain', aliases: ['unit testing', 'tdd', 'test automation', 'pytest', 'jest'] },
  { label: 'Debugging', category: 'domain', aliases: ['troubleshooting', 'root cause analysis'] },
  { label: 'Performance Optimization', category: 'domain', aliases: ['performance tuning', 'query optimization'] },
  { label: 'Security', category: 'domain', aliases: ['application security', 'appsec', 'owasp'] },
  { label: 'Agile', category: 'domain', aliases: ['scrum', 'kanban', 'sprint planning'] },

  // ── Soft skills ──────────────────────────────────────────────────────────
  { label: 'Communication', category: 'soft', aliases: ['written communication', 'verbal communication', 'presentation'] },
  { label: 'Leadership', category: 'soft', aliases: ['team lead', 'people management', 'mentoring', 'mentorship'] },
  { label: 'Teamwork', category: 'soft', aliases: ['collaboration', 'cross functional', 'cross-functional'] },
  { label: 'Problem Solving', category: 'soft', aliases: ['analytical thinking', 'critical thinking'] },
  { label: 'Stakeholder Management', category: 'soft', aliases: ['stakeholder communication', 'client facing'] },
  { label: 'Adaptability', category: 'soft', aliases: ['flexibility', 'learning agility'] },
  { label: 'Ownership', category: 'soft', aliases: ['accountability', 'self starter', 'proactive'] },
  { label: 'Conflict Resolution', category: 'soft', aliases: ['conflict management', 'negotiation'] },
  { label: 'Time Management', category: 'soft', aliases: ['prioritization', 'prioritisation'] },
  { label: 'Project Management', category: 'soft', aliases: ['pmp', 'delivery management'] },
];

/** key → entry, including every alias, built once at module load. */
const INDEX: Map<string, TaxonomyEntry> = (() => {
  const map = new Map<string, TaxonomyEntry>();
  for (const entry of SKILL_TAXONOMY) {
    map.set(toSkillKey(entry.label), entry);
    for (const alias of entry.aliases) {
      const key = toSkillKey(alias);
      // First definition wins, so an alias never shadows a canonical label.
      if (!map.has(key)) map.set(key, entry);
    }
  }
  return map;
})();

export interface ResolvedSkill {
  key: string;
  label: string;
  category: SkillCategory;
  /** True when the taxonomy recognised the skill rather than passing it through. */
  known: boolean;
}

/**
 * Resolve a free-text skill name to its canonical form.
 *
 * Unrecognised skills are returned as-is with a normalised key so nothing the
 * model or the CV mentions is silently dropped.
 */
export function resolveSkill(label: string, fallbackCategory: SkillCategory = 'technical'): ResolvedSkill {
  const trimmed = label.trim();
  const key = toSkillKey(trimmed);
  const entry = INDEX.get(key);
  if (entry) {
    return { key: toSkillKey(entry.label), label: entry.label, category: entry.category, known: true };
  }
  return { key, label: trimmed, category: fallbackCategory, known: false };
}

/**
 * Find every taxonomy skill mentioned in a block of text.
 *
 * Matching is whole-token so "R" does not fire on every word containing the
 * letter, and "Go" does not match "Google".
 */
export function detectSkills(text: string): ResolvedSkill[] {
  const haystack = ` ${text.toLowerCase().replace(/[^a-z0-9+#.\s]/g, ' ').replace(/\s+/g, ' ')} `;
  const found = new Map<string, ResolvedSkill>();

  for (const entry of SKILL_TAXONOMY) {
    const candidates = [entry.label, ...entry.aliases];
    for (const candidate of candidates) {
      const needle = candidate.toLowerCase();
      // Escape regex metacharacters present in names such as "C++" and ".NET".
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      if (pattern.test(haystack)) {
        const resolved = resolveSkill(entry.label);
        found.set(resolved.key, resolved);
        break;
      }
    }
  }

  return [...found.values()];
}

/** Adjacent skills for a given skill, used when suggesting study topics. */
export function relatedSkills(label: string): string[] {
  const entry = INDEX.get(toSkillKey(label));
  return entry?.related ? [...entry.related] : [];
}
