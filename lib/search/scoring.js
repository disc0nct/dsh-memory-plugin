/**
 * Lightweight semantic / hybrid scoring without external embedding models.
 * Uses token Jaccard + substring boosts + category weighting.
 * Dependency-free so it stays DSH-native (no heavy transformer).
 * If user provides an embedding provider via Config, it can be plugged here.
 */

const STOP_WORDS = new Set([
  "the","a","an","and","or","but","in","on","at","to","for","of","with","by","is","are","was","were","be","been","has","have","had","do","does","did","will","would","should","could","can","it","its","this","that","these","those","i","you","he","she","we","they","my","your","his","her","our","their","me","him","us","them","as","from","up","out","about","into","over","after"
]);

export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export function jaccard(aTokens, bTokens) {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Levenshtein-ish bonus for typos: if query token is prefix/substring of fact token
function tokenSubstringBonus(queryTokens, factTokens) {
  let bonus = 0;
  for (const q of queryTokens) {
    for (const f of factTokens) {
      if (f.includes(q) || q.includes(f)) bonus += 0.1;
      else if (f.startsWith(q.slice(0, 3)) && q.length > 3) bonus += 0.05;
    }
  }
  return Math.min(bonus, 0.5);
}

/**
 * Score one fact against a query.
 * @param {string} query - lowercased trimmed query
 * @param {string[]} queryTokens - tokenized query
 * @param {object} fact - {key, value, category}
 * @returns {number} 0..~5, 0 means no match
 */
export function scoreFact(query, queryTokens, fact) {
  if (!query) return 1; // empty query matches all with base 1 (recency will decide)

  const q = query;
  const keyLow = fact.key.toLowerCase();
  const catLow = fact.category.toLowerCase();
  const valLow = fact.value.toLowerCase();
  const combined = `${fact.key} ${fact.value} ${fact.category}`.toLowerCase();
  const factTokens = tokenize(combined);

  let score = 0;

  // exact substring boosts (keyword layer)
  if (keyLow.includes(q)) score += 3;
  else if (catLow.includes(q)) score += 2;
  else if (valLow.includes(q)) score += 1;

  // if no substring, try token-level substring
  if (score === 0) {
    for (const tok of queryTokens) {
      if (keyLow.includes(tok)) score += 0.8;
      else if (catLow.includes(tok)) score += 0.5;
      else if (valLow.includes(tok)) score += 0.3;
    }
  }

  // semantic layer: Jaccard + substring bonus
  const j = jaccard(queryTokens, factTokens);
  score += j * 2;
  score += tokenSubstringBonus(queryTokens, factTokens);

  // tiny boost for category exact token match (helps "project" vs "preferences")
  if (queryTokens.includes(catLow)) score += 0.5;

  return score;
}

/**
 * Hybrid search over facts.
 * @param {Array} facts - array of fact objects
 * @param {string} query
 * @param {string} category - "general" means no filter
 * @param {number} limit
 * @param {"keyword"|"semantic"|"hybrid"} mode
 * @returns {Array<{fact, score}>} sorted desc by score then recency
 */
export function hybridSearch(facts, query, category, limit, mode = "hybrid") {
  const q = (query || "").toLowerCase().trim();
  const qTokens = tokenize(q);
  const cat = (category || "general").trim() || "general";

  let candidates = facts;
  if (cat !== "general") {
    candidates = candidates.filter((f) => f.category === cat);
  }

  if (!q) {
    // no query: sort by recency
    return [...candidates]
      .sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0))
      .slice(0, limit)
      .map((fact) => ({ fact, score: 1 }));
  }

  const scored = [];
  for (const fact of candidates) {
    let score = 0;
    if (mode === "keyword") {
      const ql = q.toLowerCase();
      if (
        fact.key.toLowerCase().includes(ql) ||
        fact.value.toLowerCase().includes(ql) ||
        fact.category.toLowerCase().includes(ql)
      ) score = 1;
    } else {
      score = scoreFact(q, qTokens, fact);
      if (mode === "semantic" && score < 0.15) score = 0; // semantic threshold
      if (mode === "hybrid" && score < 0.05) score = 0;
    }
    if (score > 0) scored.push({ fact, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (Date.parse(b.fact.timestamp) || 0) - (Date.parse(a.fact.timestamp) || 0);
  });

  return scored.slice(0, limit);
}
