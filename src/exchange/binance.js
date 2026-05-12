'use strict';

const Binance = require('binance-api-node').default;

/**
 * 创建币安测试网客户端
 */
function createClient(apiKey, secretKey) {
  return Binance({
    apiKey,
    apiSecret: secretKey,
    httpBase: 'https://testnet.binance.vision/api',
    wsBase: 'wss://testnet.binance.vision/ws',
  });
}

/**
 * 获取价格
 */
async function getPrice(client, symbol) {
  try {
    const ticker = await client.prices({ symbol: symbol.toUpperCase() });
    const price = ticker[symbol.toUpperCase()];
    if (!price) return { success: false, error: `未找到币对 ${symbol}` };
    return { success: true, data: { symbol: symbol.toUpperCase(), price } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 获取非零余额
 */
async function getBalance(client) {
  try {
    const info = await client.accountInfo();
    const nonZero = info.balances.filter(b => parseFloat(b.free) > 0 || parseFloat(b.locked) > 0);
    return { success: true, data: nonZero };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 市价买入
 */
async function marketBuy(client, symbol, quantity) {
  try {
    const order = await client.order({
      symbol: symbol.toUpperCase(),
      side: 'BUY',
      type: 'MARKET',
      quantity: quantity.toString(),
    });
    const fills = order.fills || [];
    const avgPrice = fills.length > 0
      ? fills.reduce((s, f) => s + parseFloat(f.price), 0) / fills.length
      : null;
    return { success: true, data: { orderId: order.orderId, status: order.status, avgPrice, fills } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 市价卖出
 */
async function marketSell(client, symbol, quantity) {
  try {
    const order = await client.order({
      symbol: symbol.toUpperCase(),
      side: 'SELL',
      type: 'MARKET',
      quantity: quantity.toString(),
    });
    const fills = order.fills || [];
    const avgPrice = fills.length > 0
      ? fills.reduce((s, f) => s + parseFloat(f.price), 0) / fills.length
      : null;
    return { success: true, data: { orderId: order.orderId, status: order.status, avgPrice, fills } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * 获取账户信息
 */
async function getAccountInfo(client) {
  try {
    const info = await client.accountInfo();
    return { success: true, data: info };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { createClient, getPrice, getBalance, marketBuy, marketSell, getAccountInfo };
