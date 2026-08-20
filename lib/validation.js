export const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const MAX_KEY_LENGTH = 64;
export const MAX_VALUE_LENGTH = 10000;
export const MAX_CATEGORY_LENGTH = 32;
export const MAX_FACTS = 5000;
export const MAX_TIMESTAMP_MS = 4102444800000; // 2100-01-01
export const MIN_TIMESTAMP_MS = 0;

export function validateKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new Error("key must be a non-empty string");
  if (key.length > MAX_KEY_LENGTH) throw new Error(`key too long (max ${MAX_KEY_LENGTH})`);
  if (!KEY_RE.test(key)) throw new Error("key must be kebab-case: lower alphanumerics and hyphens, e.g. 'user-name'");
}
export function validateCategory(category) {
  if (category == null) return;
  if (typeof category !== "string") throw new Error("category must be a string");
  if (category.length > MAX_CATEGORY_LENGTH) throw new Error(`category too long (max ${MAX_CATEGORY_LENGTH})`);
  if (category && !KEY_RE.test(category)) throw new Error("category must be kebab-case (e.g. 'preferences', 'project')");
}
export function validateValue(value) {
  if (value == null) throw new Error("value is required");
  const s = String(value);
  if (!s.trim()) throw new Error("value must be non-empty");
  if (s.length > MAX_VALUE_LENGTH) throw new Error(`value too long (max ${MAX_VALUE_LENGTH} chars)`);
}

export function validateTimestampMs(ts) {
  if (typeof ts !== "number" || !Number.isFinite(ts)) throw new Error("timestampMs must be a finite number");
  if (ts < MIN_TIMESTAMP_MS || ts > MAX_TIMESTAMP_MS) throw new Error(`timestampMs out of range (0..${MAX_TIMESTAMP_MS})`);
}
