export function buildCrossVenueComparison(symbol, observations, thresholdPercent = 0.5) {
  const valid = observations.filter((item) => Number.isFinite(item.last) && item.last > 0);
  const sorted = valid.map((item) => item.last).sort((a, b) => a - b);
  const median = sorted.length ? (sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2) : null;
  const lowestAsk = valid.filter((item) => Number.isFinite(item.ask) && item.ask > 0).sort((a, b) => a.ask - b.ask)[0] || null;
  const highestBid = valid.filter((item) => Number.isFinite(item.bid) && item.bid > 0).sort((a, b) => b.bid - a.bid)[0] || null;
  const grossEdgePercent = lowestAsk && highestBid && lowestAsk.exchange !== highestBid.exchange && lowestAsk.ask > 0
    ? ((highestBid.bid - lowestAsk.ask) / lowestAsk.ask) * 100 : null;
  return {
    symbol, generatedAt: new Date().toISOString(), venueCount: valid.length,
    medianLast: median,
    lastPriceSpreadPercent: sorted.length > 1 && median ? ((sorted[sorted.length - 1] - sorted[0]) / median) * 100 : null,
    bestExecutableTopOfBook: lowestAsk && highestBid ? {
      buyVenue: lowestAsk.exchange, ask: lowestAsk.ask,
      sellVenue: highestBid.exchange, bid: highestBid.bid,
      grossEdgePercent
    } : null,
    venues: valid.map((item) => ({
      ...item,
      deviationFromMedianPercent: median ? ((item.last - median) / median) * 100 : null,
      outlier: valid.length >= 3 && median ? Math.abs((item.last - median) / median) * 100 > thresholdPercent : false
    })),
    caveats: [
      'Top-of-book comparison is indicative only; it excludes trading fees, funding, slippage, latency, queue position, transfer costs and venue-specific restrictions.',
      'Displayed bid/ask sizes are not modeled. A positive gross edge is not proof of an executable arbitrage.',
      'Only venues that returned a valid ticker are included; market symbols and quote conventions must match.'
    ]
  };
}
