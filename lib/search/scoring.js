/**
 * Lightweight semantic / hybrid scoring without external embedding models.
 * Uses token Jaccard + substring boosts + category weighting.
 * Dependency-free so it stays DSH-native (no heavy transformer).
 * If user provides an embedding provider via Config, it can be plugged here.
 *
 * Phase 2: Inverted index + tokenization caching for sub-linear search.
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
  // accept arrays or Sets
  const aArr = Array.isArray(aTokens) ? aTokens : [...aTokens];
  const bArr = Array.isArray(bTokens) ? bTokens : [...bTokens];
  if (aArr.length === 0 || bArr.length === 0) return 0;
  const a = new Set(aArr);
  const b = new Set(bArr);
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Levenshtein-ish bonus for typos: if query token is prefix/substring of fact token
function tokenSubstringBonus(queryTokens, factTokens) {
  const qArr = Array.isArray(queryTokens) ? queryTokens : [...queryTokens];
  const fArr = Array.isArray(factTokens) ? factTokens : [...factTokens];
  let bonus = 0;
  for (const q of qArr) {
    if (q.length < 3) continue;
    for (const f of fArr) {
      if (f.length < 3) continue;
      if (f.includes(q) || q.includes(f)) bonus += 0.1;
      else if (f.startsWith(q.slice(0, 3))) bonus += 0.05;
    }
  }
  return Math.min(bonus, 0.5);
}

// --- Phase 2: Tokenization caching + Inverted index ---

// Map<fact.id, {hash:string, tokens:Set<string>}>
const _tokenCache = new Map();

// Map<token, Set<fact.id>>
const _invertedIndex = new Map();
let _indexFactsRef = null;
let _indexSize = 0;

function _factHash(fact) {
  return `${fact.key}\0${fact.value}\0${fact.category}`;
}

function getFactTokens(fact) {
  const hash = _factHash(fact);
  const cached = _tokenCache.get(fact.id);
  if (cached && cached.hash === hash) return cached.tokens;
  const tokens = new Set(tokenize(`${fact.key} ${fact.value} ${fact.category}`));
  _tokenCache.set(fact.id, { hash, tokens });
  return tokens;
}

function buildIndex(facts) {
  // quick check: if facts reference and size same as last build, assume valid
  // we need to detect content change; we use id set size + hash check
  if (_indexFactsRef === facts && _indexSize === facts.length) {
    // check if any fact's hash changed (content changed but same id)
    let dirty = false;
    for (const f of facts) {
      const hash = _factHash(f);
      const cached = _tokenCache.get(f.id);
      if (!cached || cached.hash !== hash) { dirty = true; break; }
    }
    if (!dirty) return;
  }
  _invertedIndex.clear();
  for (const f of facts) {
    const tokens = getFactTokens(f);
    for (const t of tokens) {
      let set = _invertedIndex.get(t);
      if (!set) { set = new Set(); _invertedIndex.set(t, set); }
      set.add(f.id);
    }
  }
  _indexFactsRef = facts;
  _indexSize = facts.length;
  // prune stale cache entries for ids no longer present
  if (_tokenCache.size > facts.length * 2) {
    const ids = new Set(facts.map((f) => f.id));
    for (const id of _tokenCache.keys()) if (!ids.has(id)) _tokenCache.delete(id);
  }
}

// for tests
export function _clearIndex() {
  _invertedIndex.clear();
  _tokenCache.clear();
  _indexFactsRef = null;
  _indexSize = 0;
}

/**
 * Score one fact against a query.
 * @param {string} query - lowercased trimmed query
 * @param {string[]} queryTokens - tokenized query
 * @param {Set<string>} queryTokensSet - set of query tokens for Jaccard
 * @param {object} fact - {key, value, category}
 * @param {Set<string>} factTokensSet - cached fact tokens
 * @returns {number} 0..~5, 0 means no match
 */
export function scoreFact(query, queryTokens, fact, factTokensSet) {
  // support old signature scoreFact(query, queryTokens, fact) where factTokens not passed
  let qTokens = queryTokens;
  let qSet = null;
  let fTokens = factTokensSet;
  // detect overload: if 4th arg is fact and 5th is undefined, then queryTokens is array, fact is object
  // new signature: scoreFact(query, qTokens, qSet, fact, fTokens) - but we keep simple
  // we handle both: if factTokensSet is undefined, compute
  if (!fTokens) {
    const combined = `${fact.key} ${fact.value} ${fact.category}`.toLowerCase();
    // use cached if available
    fTokens = getFactTokens(fact);
    qSet = new Set(qTokens);
  } else {
    qSet = new Set(qTokens);
  }
  if (!query) return 1;

  const q = query;
  const keyLow = fact.key.toLowerCase();
  const catLow = fact.category.toLowerCase();
  const valLow = fact.value.toLowerCase();

  let score = 0;

  if (keyLow.includes(q)) score += 3;
  else if (catLow.includes(q)) score += 2;
  else if (valLow.includes(q)) score += 1;

  if (score === 0) {
    for (const tok of qTokens) {
      if (keyLow.includes(tok)) score += 0.8;
      else if (catLow.includes(tok)) score += 0.5;
      else if (valLow.includes(tok)) score += 0.3;
    }
  }

  const j = jaccard(qSet, fTokens);
  score += j * 2;
  score += tokenSubstringBonus(qSet, fTokens);

  if (qSet.has(catLow)) score += 0.5;

  return score;
}

// wrapper for backward compat: old scoreFact(query, queryTokens, fact) -> calls new with cached
const _scoreFactCompat = (query, queryTokens, fact) => {
  const fTokens = getFactTokens(fact);
  const qSet = new Set(queryTokens);
  return scoreFact(query, queryTokens, fact, fTokens);
};
// export compat as scoreFact for existing callers that pass 3 args, but new code passes 4
// we keep scoreFact as compat, and also expose internal

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
  const qSet = new Set(qTokens);
  const cat = (category || "general").trim() || "general";

  let candidates = facts;
  if (cat !== "general") {
    candidates = candidates.filter((f) => f.category === cat);
  }

  if (!q) {
    return [...candidates]
      .sort((a, b) => {
        const ta = a.timestampMs ?? Date.parse(a.timestamp) ?? 0;
        const tb = b.timestampMs ?? Date.parse(b.timestamp) ?? 0;
        return tb - ta;
      })
      .slice(0, limit)
      .map((fact) => ({ fact, score: 1 }));
  }

  // Phase 2: try inverted index for semantic/hybrid to get sub-linear candidate set
  let scored = [];
  let useIndex = false;
  let indexedCandidates = null;

  if (mode !== "keyword" && qTokens.length > 0) {
    try {
      buildIndex(candidates);
      // union of id sets for query tokens
      const idUnion = new Set();
      for (const tok of qTokens) {
        const ids = _invertedIndex.get(tok);
        if (ids) for (const id of ids) idUnion.add(id);
        // also try substring of token in index keys for typo tolerance (prefix)
        // to keep sub-linear, we only check tokens that start with tok slice
        if (!ids && tok.length > 3) {
          const prefix = tok.slice(0, 3);
          for (const [key, set] of _invertedIndex) {
            if (key.startsWith(prefix) && (key.includes(tok) || tok.includes(key))) {
              for (const id of set) idUnion.add(id);
            }
          }
        }
      }
      // if we found candidates via index, use them; otherwise fallback to linear (graceful)
      if (idUnion.size > 0) {
        // also include substring matches that may not be token hits (category/key includes q)
        // to avoid missing keyword-style hits when index is sparse, we will add those via linear fallback if needed
        const idMap = new Map(candidates.map((f) => [f.id, f]));
        indexedCandidates = [...idUnion].map((id) => idMap.get(id)).filter(Boolean);
        // if union is much smaller than candidates, use it; else fallback to full scan for scoring completeness
        if (indexedCandidates.length > 0 && indexedCandidates.length < candidates.length * 0.8) {
          useIndex = true;
          candidates = indexedCandidates;
        }
      }
    } catch {
      // graceful degradation: ignore index errors, fallback to linear
      useIndex = false;
    }
  }

  // if not using index, candidates remains filtered by category only (linear)
  // if using index, candidates is reduced set

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
      // use cached tokens
      const fTokens = getFactTokens(fact);
      score = scoreFact(q, qTokens, fact, fTokens);
      if (mode === "semantic" && score < 0.15) score = 0;
      if (mode === "hybrid" && score < 0.05) score = 0;
    }
    if (score > 0) scored.push({ fact, score });
  }

  // graceful fallback: if index gave 0 results but query is non-empty, try linear scan without index
  if (useIndex && scored.length === 0 && mode !== "keyword") {
    // fallback linear on original candidates (before index reduction)
    // we need original filtered list; reconstruct
    let original = facts;
    if (cat !== "general") original = original.filter((f) => f.category === cat);
    scored = [];
    for (const fact of original) {
      const fTokens = getFactTokens(fact);
      let s = scoreFact(q, qTokens, fact, fTokens);
      if (mode === "semantic" && s < 0.15) s = 0;
      if (mode === "hybrid" && s < 0.05) s = 0;
      if (s > 0) scored.push({ fact, score: s });
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = a.fact.timestampMs ?? Date.parse(a.fact.timestamp) ?? 0;
    const tb = b.fact.timestampMs ?? Date.parse(b.fact.timestamp) ?? 0;
    return tb - ta;
  });

  return scored.slice(0, limit);
}
