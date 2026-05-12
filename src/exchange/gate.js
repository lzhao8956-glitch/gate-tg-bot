'use strict';

const crypto = require('crypto');

/**
 * Gate.io API v4 客户端（永续合约/现货）
 * 文档: https://www.gate.io/docs/developers/apiv4/cn/
 */

const BASE_URL = 'https://api.gateio.xyz';
const TESTNET_URL = 'https://fx-api-testnet.gateio.xyz';

// ── 签名 ──────────────────────────────────────────────────────────

function sign(queryString, secret) {
  const hmac = crypto.createHmac('sha512', secret);
  hmac.update(queryString);
  return hmac.digest('hex');
}

function makeHeaders(method, path, queryString, body, apiKey, secretKey) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const host = 'api.gateio.xyz';
  const hashedPayload = body ? crypto.createHash('sha512').update(body).digest('hex') : '';

  const signedString = [method, host, path, timestamp + queryString + hashedPayload].join('\n');
  const signature = sign(signedString, secretKey);

  return {
    'KEY': apiKey,
    'SIGN': signature,
    'Timestamp': timestamp,
    'Content-Type': 'application/json',
  };
}

// ── 辅助 ──────────────────────────────────────────────────────────

async function gatedRequest(method, path, params, apiKey, secretKey) {
  // 优先以显式环境变量判断testnet，其次才看apiKey前缀（兼容旧的test-前缀key）
  const isTestnet = (process.env.GATE_NETWORK || '').toLowerCase() === 'testnet' ||
                    (!apiKey || apiKey.startsWith('test-'));
  const base = isTestnet ? TESTNET_URL : BASE_URL;

  const queryParts = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') {
      queryParts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
  }
  const queryString = queryParts.length > 0 ? '?' + queryParts.join('&') : '';
  const body = (method === 'POST' || method === 'DELETE') ? JSON.stringify(params) : '';
  const headers = makeHeaders(method, path, queryString, body, apiKey, secretKey);

  const url = base + path + queryString;
  const resp = await fetch(url, {
    method,
    headers,
    body: body || undefined,
  });

  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!resp.ok) {
    return { success: false, error: `HTTP ${resp.status}: ${text.slice(0, 200)}` };
  }

  return { success: true, data };
}

// ── 永续合约接口 ───────────────────────────────────────────────────

/**
 * 获取合约列表
 */
async function getFuturesContracts(apiKey, secretKey) {
  return gatedRequest('GET', '/futures/usdt/contracts', {}, apiKey, secretKey);
}

/**
 * 获取合约交易对行情
 */
async function getFuturesTicker(contract, apiKey, secretKey) {
  return gatedRequest('GET', `/futures/usdt/contracts/${contract}/tickers`, {}, apiKey, secretKey);
}

/**
 * 获取账户信息
 */
async function getFuturesAccount(apiKey, secretKey) {
  return gatedRequest('GET', '/futures/usdt/accounts', {}, apiKey, secretKey);
}

/**
 * 获取合约持仓
 */
async function getFuturesPositions(apiKey, secretKey) {
  return gatedRequest('GET', '/futures/usdt/positions', {}, apiKey, secretKey);
}

/**
 * 市价开多/空
 * @param {string} contract - 合约名 如 BTC_USDT
 * @param {string} size - 正数=多头 负数=空头
 */
async function futuresPlaceOrder(contract, size, price, apiKey, secretKey) {
  const params = {
    contract: contract,
    size: size,
    price: price || 0,
    order_type: price ? 'limit' : 'market',
    type: 'both',
  };
  return gatedRequest('POST', '/futures/usdt/orders', params, apiKey, secretKey);
}

/**
 * 市价买入（做多）
 */
async function futuresBuy(contract, size, apiKey, secretKey) {
  return futuresPlaceOrder(contract, Math.abs(size), 0, apiKey, secretKey);
}

/**
 * 市价卖出（做空）
 */
async function futuresSell(contract, size, apiKey, secretKey) {
  return futuresPlaceOrder(contract, -Math.abs(size), 0, apiKey, secretKey);
}

/**
 * 获取当前价格
 */
async function getPrice(contract, apiKey, secretKey) {
  // Gate.io 永续合约行情接口：GET /futures/usdt/tickers 返回所有合约行情
  // 单币查询用 /futures/usdt/contracts/{contract}/tickers（getFuturesTicker已实现）
  // 此处返回所有行情，由调用方过滤指定合约
  return gatedRequest('GET', '/futures/usdt/tickers', {}, apiKey, secretKey);
}

/**
 * 根据合约名从tickers结果中找单币行情
 */
function findTickerInList(tickers, contract) {
  if (!Array.isArray(tickers)) return null;
  // 兼容合约名带不带的下划线
  const target = contract.toUpperCase().replace('_USDT', '_USDT');
  return tickers.find(t => (t.contract || '').toUpperCase() === target) || null;
}

/**
 * 现货买单
 */
async function spotBuy(currencyPair, amount, price, apiKey, secretKey) {
  const params = {
    currency_pair: currencyPair,
    side: 'buy',
    amount,
    type: price ? 'limit' : 'market',
    price: price || 0,
  };
  return gatedRequest('POST', '/spot/orders', params, apiKey, secretKey);
}

/**
 * 现货卖单
 */
async function spotSell(currencyPair, amount, price, apiKey, secretKey) {
  const params = {
    currency_pair: currencyPair,
    side: 'sell',
    amount,
    type: price ? 'limit' : 'market',
    price: price || 0,
  };
  return gatedRequest('POST', '/spot/orders', params, apiKey, secretKey);
}

/**
 * 现货账户余额
 */
async function getSpotBalance(apiKey, secretKey) {
  return gatedRequest('GET', '/spot/accounts', {}, apiKey, secretKey);
}

/**
 * 合约强平价格（用于风控）
 */
async function getLiquidationPrice(contract, apiKey, secretKey) {
  return gatedRequest('GET', `/futures/usdt/positions/${contract}`, {}, apiKey, secretKey);
}

module.exports = {
  getFuturesContracts,
  getFuturesTicker,
  getFuturesAccount,
  getFuturesPositions,
  futuresBuy,
  futuresSell,
  futuresPlaceOrder,
  getPrice,
  spotBuy,
  spotSell,
  getSpotBalance,
  getLiquidationPrice,
  BASE_URL,
  TESTNET_URL,
};