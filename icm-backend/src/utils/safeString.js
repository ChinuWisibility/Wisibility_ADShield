/** Normalize API errors (including objects) for storage and logs. */
export function safeErrorString(value, maxLen = 4000) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value.slice(0, maxLen);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).slice(0, maxLen);
    } catch {
      return String(value).slice(0, maxLen);
    }
  }
  return String(value).slice(0, maxLen);
}
