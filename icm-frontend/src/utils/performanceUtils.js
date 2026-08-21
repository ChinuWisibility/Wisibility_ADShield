// Performance utilities — ported from wisibility

// ─── LRU Data Cache ───────────────────────────────────────────────────────────
class DataCache {
  constructor(maxSize = 50, ttl = 5 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  set(key, value) {
    if (this.cache.size >= this.maxSize) {
      this.cache.delete(this.cache.keys().next().value);
    }
    this.cache.set(key, { value, timestamp: Date.now() });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() - item.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  has(key) {
    const item = this.cache.get(key);
    return !!(item && Date.now() - item.timestamp <= this.ttl);
  }

  clear() {
    this.cache.clear();
  }
}

export const dataCache = new DataCache();

// ─── Debounce ─────────────────────────────────────────────────────────────────
export const debounce = (func, wait) => {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      clearTimeout(timeout);
      func(...args);
    }, wait);
  };
};

// ─── Throttle ─────────────────────────────────────────────────────────────────
export const throttle = (func, limit) => {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
};

// ─── Memory Usage ─────────────────────────────────────────────────────────────
export const getMemoryUsage = () => {
  if (performance.memory) {
    return {
      used: Math.round(performance.memory.usedJSHeapSize / 1048576), // MB
      total: Math.round(performance.memory.totalJSHeapSize / 1048576), // MB
      limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576), // MB
    };
  }
  return null;
};

// ─── Measure ──────────────────────────────────────────────────────────────────
export const measurePerformance = (name, fn) => {
  const start = performance.now();
  const result = fn();
  console.log(`[Perf] ${name}: ${(performance.now() - start).toFixed(2)}ms`);
  return result;
};

// ─── Virtual Scroll Helper ────────────────────────────────────────────────────
export const getVisibleItems = (
  items,
  scrollTop,
  itemHeight,
  containerHeight,
) => {
  const startIndex = Math.floor(scrollTop / itemHeight);
  const endIndex = Math.min(
    startIndex + Math.ceil(containerHeight / itemHeight) + 1,
    items.length,
  );
  return {
    items: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    totalHeight: items.length * itemHeight,
  };
};

// ─── Chunk Processor (non-blocking) ──────────────────────────────────────────
export const processDataInChunks = (data, chunkSize = 1000, processor) =>
  new Promise((resolve) => {
    const results = [];
    let index = 0;
    const processChunk = () => {
      const chunk = data.slice(index, index + chunkSize);
      if (chunk.length === 0) {
        resolve(results);
        return;
      }
      results.push(...processor(chunk));
      index += chunkSize;
      (window.requestIdleCallback || setTimeout)(processChunk, 0);
    };
    processChunk();
  });
