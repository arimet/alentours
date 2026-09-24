// fetch() with retries for long data pipelines: public servers sometimes drop a connection
// (seen in CI on Arcep's server) or answer 5xx for a moment. 4xx are not retried.
export const fetchRetry = async (url, { tries = 4, waitMs = 5000, fetchFn = fetch, log = console.warn } = {}) => {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchFn(url);
      if (res.status < 500 || attempt === tries) return res;
      log(`${url}: HTTP ${res.status}, retry ${attempt}/${tries - 1}`);
    } catch (e) {
      if (attempt === tries) throw e;
      log(`${url}: ${e.cause?.code ?? e.message}, retry ${attempt}/${tries - 1}`);
    }
    await new Promise((r) => setTimeout(r, waitMs * attempt));
  }
};
