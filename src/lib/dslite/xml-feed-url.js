const DSLITE_XML_FEED_HOST = 'app.dslite.com.br';
const DSLITE_XML_FEED_PATH = /^\/modules\/admin\/Empresa\/getXMLCrossdocking\/([0-9]+)\/[A-Za-z0-9_-]{16,256}\/?$/;

/**
 * Valida e normaliza a URL confidencial do catálogo Crossdocking da DSLite.
 * O token permanece encapsulado na URL e nunca é retornado separadamente.
 *
 * @param {unknown} value
 * @param {string | number | null | undefined} [expectedSupplierId]
 * @returns {{ normalizedUrl: string, supplierId: string } | null}
 */
function parseDsliteXmlFeedUrl(value, expectedSupplierId) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw || raw.length > 2048) return null;

  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:'
      || url.hostname !== DSLITE_XML_FEED_HOST
      || url.port
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }

    const path = DSLITE_XML_FEED_PATH.exec(url.pathname);
    if (!path) return null;

    const supplierId = path[1];
    const expected = String(expectedSupplierId ?? '').trim();
    if (expected && supplierId !== expected) return null;

    return { normalizedUrl: url.toString(), supplierId };
  } catch {
    return null;
  }
}

module.exports = { parseDsliteXmlFeedUrl };
