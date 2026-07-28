/**
 * Deep Research prompts.
 */

/**
 * Preamble that grounds query-generation/planning LLMs in the real current date.
 * @returns {string}
 */
export function currentDateContext() {
  const now = new Date();
  const monthDayYear = now.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const isoDate = now.toLocaleDateString('en-CA');
  const year = String(now.getFullYear());
  return (
    `Today's date is ${monthDayYear} (${isoDate}). ` +
    `When a search query needs a year or refers to 'latest'/'current'/` +
    `'this year', use ${year} or relative wording — never a ` +
    `year inferred from training data.\n\n`
  );
}

export const RESEARCH_PLAN_PROMPT_CODEBASE = `You are a research strategist analyzing a local codebase. Before searching files, create a research plan.

**Question:** {question}

Break this question down for codebase investigation:
1. Which modules, directories, or file types are most likely to hold answers?
2. What symbols, APIs, config keys, or patterns should we grep for?
3. What would a complete, file-grounded answer include?

Return a JSON object with:
- "sub_questions": Array of 3-6 specific sub-questions to investigate in the repo
- "key_topics": Array of directories, file patterns, or symbol names to search
- "success_criteria": One sentence describing what a complete codebase-grounded answer looks like

Example:
{
  "sub_questions": ["Where is auth middleware registered?", "How are tokens validated?"],
  "key_topics": ["server/auth", "middleware", "JWT", "routes.js"],
  "success_criteria": "A report citing specific files and functions that implement authentication."
}
`;

export const RESEARCH_PLAN_PROMPT = `You are a research strategist. Before searching, analyze this question and create a research plan.

**Question:** {question}

Break this question down:
1. What are the key sub-topics that need to be covered for a comprehensive answer?
2. What specific data points, facts, or perspectives should we look for?
3. What would a complete, high-quality answer include?

Return a JSON object with:
- "sub_questions": Array of 3-6 specific sub-questions to investigate
- "key_topics": Array of key topics/angles to cover
- "success_criteria": One sentence describing what a complete answer looks like

Example:
{
  "sub_questions": ["What is the cost of living in X?", "How is the healthcare system?"],
  "key_topics": ["economy", "healthcare", "safety", "culture"],
  "success_criteria": "A balanced comparison covering cost, quality of life, and practical considerations."
}
`;

export const CODEBASE_QUERY_GEN_PROMPT = `You are a research assistant planning local codebase searches (ripgrep + file reads).

**Original question:** {question}

**Research plan:**
{research_plan}

**What we know so far:**
{report}

**Round:** {round_num}

Generate {num_queries} focused codebase search queries — short keywords, symbol names, path fragments, or grep patterns that will locate relevant source files.
{round_instruction}

Prefer concrete identifiers (function names, config keys, error strings) over vague prose.
Return ONLY a JSON array of query strings, nothing else.
Example: ["DeepResearcher", "searchAndExtract", "server/research/engine"]
`;

export const QUERY_GEN_PROMPT = `You are a research assistant planning web searches.

**Original question:** {question}

**Research plan:**
{research_plan}

**What we know so far:**
{report}

**Round:** {round_num}

Generate {num_queries} focused search queries that will help answer the question.
{round_instruction}

Return ONLY a JSON array of query strings, nothing else.
Example: ["query one", "query two", "query three"]
`;

export const SYNTHESIZE_PROMPT = `You are updating an evolving research report.

**Original question:** {question}

**Current report:**
{report}

**New findings from this round:**
{new_findings}

Integrate the new findings into the existing report. Produce an updated, well-organized \
report that answers the original question as completely as possible given all evidence so far. \
Remove redundancy, resolve contradictions, and maintain logical flow. \
Keep source URLs as inline citations where relevant.

Write only the updated report — no preamble or meta-commentary.
`;

export const STOP_PROMPT = `You are deciding whether a research report is comprehensive enough.

**Original question:** {question}

**Current report:**
{report}

**Rounds completed:** {round_num}

Based on the report so far, do we have enough information to answer the question \
comprehensively?  Consider:
- Are the key aspects of the question addressed?
- Are there obvious gaps or unanswered sub-questions?
- Is the evidence sufficient and from multiple sources?

Reply with ONLY "YES" or "NO" followed by a brief one-sentence reason.
Example: "YES — The report covers all major aspects with evidence from multiple sources."
Example: "NO — We still lack information about the economic impact."
`;

export const FINAL_REPORT_PROMPT = `Write a **long, detailed, comprehensive** research report answering this question:

**Question:** {question}

**All collected evidence and analysis:**
{report}

Requirements:
- Write at MINIMUM 1500 words — this should be a thorough, magazine-quality article
- Use clear ## headings and ### subheadings to organize into logical sections
- Each section should have multiple detailed paragraphs, not just bullet points
- Synthesize and analyze the information — explain WHY things matter, draw comparisons, provide context
- Include specific data points, numbers, and statistics from the evidence
- Include source URLs as inline citations [like this](url)
- Note where sources agree and where they disagree
- Add a brief executive summary at the top
- End with a clear conclusion that directly answers the question
- Write in an engaging, informative style — not dry or robotic
`;

export const CATEGORY_PROMPTS = {
  technical: `IMPORTANT FORMAT OVERRIDE — this is a TECHNICAL research brief:
- Start with ## TL;DR (3–5 sentences) then ## Key findings with ### subsections per theme
- Emphasize specs, benchmarks, architecture, implementation detail, and trade-offs
- Include comparison tables when multiple tools/models/frameworks are involved
- Use inline [n] citation markers tied to the source list
- End with ## Suggested follow-ups (3 short research questions)`,

  academic: `IMPORTANT FORMAT OVERRIDE — this is an ACADEMIC research brief:
- Start with ## TL;DR then ## Key findings organized by theme or paper cluster
- Prioritize peer-reviewed sources, preprints, and primary methodology
- Note agreement/disagreement across studies; call out sample size and limitations
- Use formal but readable tone with inline [n] citations
- End with ## Suggested follow-ups for open research questions`,

  news: `IMPORTANT FORMAT OVERRIDE — this is a NEWS / current-events brief:
- Start with ## TL;DR emphasizing what changed recently and why it matters now
- Organize ## Key findings chronologically or by stakeholder
- Weight recency; distinguish reporting from primary sources
- Flag unverified claims; use inline [n] citations
- End with ## Suggested follow-ups on developing story angles`,

  market: `IMPORTANT FORMAT OVERRIDE — this is a MARKET / competitive landscape brief:
- Start with ## TL;DR on positioning, pricing, and market dynamics
- Include a ## Comparison table when comparing vendors/products
- Cover pricing, GTM, differentiation, and trends per ### player or segment
- Use inline [n] citations; note where data is vendor-reported vs independent
- End with ## Suggested follow-ups on market gaps or risks`,

  general: `IMPORTANT FORMAT OVERRIDE — this is a GENERAL research brief:
- Start with ## TL;DR (executive summary) then ## Key findings with clear ### headings
- Balance breadth and depth; synthesize across source types
- Use inline [n] citation markers
- End with ## Suggested follow-ups (3 concrete next questions)`,
};

/** Map legacy persisted categories to the current taxonomy. */
export const LEGACY_CATEGORY_ALIASES = {
  product: 'technical',
  comparison: 'market',
  howto: 'technical',
  factcheck: 'news',
};

/**
 * @param {string | null | undefined} category
 * @returns {string}
 */
export function normalizeResearchCategory(category) {
  const raw = String(category ?? '').trim().toLowerCase();
  if (!raw) {
    return '';
  }
  const legacy = /** @type {Record<string, string>} */ (LEGACY_CATEGORY_ALIASES)[raw];
  if (legacy) {
    return legacy;
  }
  if (raw in CATEGORY_PROMPTS) {
    return raw;
  }
  return 'general';
}

export const EXTRACTOR_PROMPT = `Please process the following webpage content and user goal to extract relevant information:

## **Webpage Content**
{webpage_content}

## **User Goal**
{goal}

## **Task Guidelines**
1. **Content Scanning for Rational**: Locate the **specific sections/data** directly related to the user's goal within the webpage content
2. **Key Extraction for Evidence**: Identify and extract the **most relevant information** from the content, you never miss any important information, output the **full original context** of the content as far as possible, it can be more than three paragraphs.
3. **Summary Output for Summary**: Organize into a concise paragraph with logical flow, prioritizing clarity and judge the contribution of the information to the goal.

**Final Output Format using JSON format has "rational", "evidence", "summary" fields**

Example output:
{
    "rational": "This section discusses X which directly relates to the goal of understanding Y",
    "evidence": "Full quotes and context from the page...",
    "summary": "Concise summary of how this information answers the goal"
}
`;

/**
 * Replace `{name}` placeholders in a prompt template.
 * @param {string} template
 * @param {Record<string, string | number>} values
 * @returns {string}
 */
export function formatPrompt(template, values) {
  return template.replace(/\{(\w+)\}/g, (_match, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}
