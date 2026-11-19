import { z } from 'zod';

export const orderSchema = z.object({
  symbol: z.string().min(3).max(40),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit']),
  amount: z.number().finite().positive().max(1_000_000),
  price: z.number().finite().positive().optional(),
  clientOrderId: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional()
}).superRefine((value, ctx) => {
  if (value.type === 'limit' && !value.price) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'A positive limit price is required.' });
  }
});

export function assertLiveTradingAllowed(req, exchange, market, order, referencePrice) {
  if (process.env.JPTI_TRADING_MODE !== 'live' || process.env.JPTI_ENABLE_LIVE_TRADING !== 'true') {
    throw Object.assign(new Error('Live trading is locked. Set JPTI_TRADING_MODE=live and JPTI_ENABLE_LIVE_TRADING=true only after completing paper validation.'), { status: 403 });
  }
  const expectedToken = process.env.JPTI_API_TOKEN;
  if (!expectedToken || req.get('x-jpti-api-token') !== expectedToken) {
    throw Object.assign(new Error('Missing or invalid JPTI API authorization token.'), { status: 401 });
  }
  if (req.get('x-jpti-live-confirmation') !== 'I_ACKNOWLEDGE_LIVE_TRADING') {
    throw Object.assign(new Error('Explicit live-trading confirmation header is required.'), { status: 403 });
  }
  if (!market || market.active === false || market.spot === false) {
    throw Object.assign(new Error('Only active spot markets are enabled by this execution gateway.'), { status: 400 });
  }
  if (!exchange.has?.createOrder) {
    throw Object.assign(new Error('This exchange adapter does not support order creation.'), { status: 501 });
  }
  const price = order.type === 'limit' ? order.price : referencePrice;
  if (!Number.isFinite(price) || price <= 0) {
    throw Object.assign(new Error('A valid reference price is required for notional risk checks.'), { status: 422 });
  }
  const maxNotional = Number(process.env.JPTI_MAX_ORDER_NOTIONAL_USDT || 100);
  const quote = market.quote;
  if (quote !== 'USDT') {
    throw Object.assign(new Error('The initial live-order guard currently permits USDT-quoted spot pairs only.'), { status: 403 });
  }
  const notional = order.amount * price;
  if (!Number.isFinite(maxNotional) || maxNotional <= 0 || notional > maxNotional) {
    throw Object.assign(new Error(`Order notional ${notional.toFixed(4)} exceeds configured per-order cap ${maxNotional} USDT.`), { status: 403 });
  }
  return { estimatedNotional: notional, maxNotional };
}

export function requirePrivateApiAuth(req) {
  const expectedToken = process.env.JPTI_API_TOKEN;
  if (!expectedToken || req.get('x-jpti-api-token') !== expectedToken) {
    throw Object.assign(new Error('Missing or invalid JPTI API authorization token.'), { status: 401 });
  }
}
