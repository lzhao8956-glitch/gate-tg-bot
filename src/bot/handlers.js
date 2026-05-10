'use strict';

const TelegramBot = require('node-telegram-bot-api');
const binance = require('../exchange/binance');
const gate = require('../exchange/gate');

const EXCHANGE_BTC = process.env.EXCHANGE || 'gate'; // 'binance' | 'gate'

/**
 * 统一交易所接口
 */
function getExchange() {
  if (EXCHANGE_BTC === 'binance') return { module: binance, name: '币安测试网' };
  return { module: gate, name: 'Gate.io' };
}

/**
 * 创建TG Bot并注册所有命令处理器
 */
function createBot(token, client, riskControl, logger) {
  const bot = new TelegramBot(token, { polling: true });
  const exchange = getExchange();

  // ── 工具函数 ─────────────────────────────────────────────────
  function formatNumber(n, decimals = 8) {
    return parseFloat(n).toFixed(decimals).replace(/\.?0+$/, '');
  }

  function safeSend(chatId, text) {
    try { bot.sendMessage(chatId, text, { parse_mode: 'Markdown' }); } catch (e) {
      logger.error('发送消息失败', { chatId, error: e.message });
    }
  }

  // ── /start ─────────────────────────────────────────────────────
  bot.onText(/^\/start$/, (msg) => {
    const chatId = msg.chat.id;
    const lines = [
      `🤖 *Gate.io 交易机器人*`,
      ``,
      `交易所: ${exchange.name}`,
      `网络: ${process.env.GATE_NETWORK || 'mainnet'}`,
      ``,
      `*可用命令:*`,
      '`/start` - 显示此帮助',
      '`/price <币对>` - 查询价格',
      '`/balance` - 查询余额',
      '`/buy <币对> <数量>` - 市价买入',
      '`/sell <币对> <数量>` - 市价卖出',
      '`/positions` - 查看持仓',
      '`/status` - 运行状态',
      '`/help` - 详细帮助',
    ];
    safeSend(chatId, lines.join('\n'));
    logger.info(`用户 ${chatId} /start`);
  });

  // ── /price ────────────────────────────────────────────────────
  bot.onText(/^\/price\s+(\S+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!client) return safeSend(chatId, `❌ ${exchange.name}未连接`);
    const symbol = match[1].toUpperCase();

    // Gate.io 永续合约格式 BTC_USDT
    const contract = symbol.includes('_') ? symbol : `${symbol}_USDT`;

    const result = await gate.getFuturesTicker(contract, client.apiKey, client.secretKey);
    if (result.success && result.data) {
      const t = result.data;
      const msg2 = [
        `📊 *${contract} 行情*`,
        `最新价: \`${t.last || t.price || 'N/A'}\``,
        `买一: \`${t.bid || 'N/A'}\`  卖一: \`${t.ask || 'N/A'}\``,
        `24h涨跌: \`${t.change || 'N/A'}\`  24h高: \`${t.high_24h || 'N/A'}\`  24h低: \`${t.low_24h || 'N/A'}\``,
        `24h成交量: \`${t.volume || 'N/A'}\``,
      ].join('\n');
      safeSend(chatId, msg2);
    } else {
      safeSend(chatId, `❌ 查询失败: ${result.error || '未知错误'}`);
    }
  });

  // ── /balance ──────────────────────────────────────────────────
  bot.onText(/^\/balance$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!client) return safeSend(chatId, `❌ ${exchange.name}未连接`);

    const result = await gate.getSpotBalance(client.apiKey, client.secretKey);
    if (result.success && Array.isArray(result.data)) {
      const nonZero = result.data.filter(b => parseFloat(b.available || b.balance || 0) > 0);
      if (nonZero.length === 0) return safeSend(chatId, '📭 余额为空');
      const lines = nonZero.map(b =>
        `• *${b.currency}*: 可用 \`${formatNumber(b.available || b.balance)}\`  冻结 \`${formatNumber(b.locked || '0')}\``
      );
      safeSend(chatId, `📊 *${exchange.name} 现货余额*\n\n${lines.join('\n')}`);
    } else {
      safeSend(chatId, `❌ 查询失败: ${result.error || '未知错误'}`);
    }
  });

  // ── /positions ─────────────────────────────────────────────────
  bot.onText(/^\/positions$/, async (msg) => {
    const chatId = msg.chat.id;
    if (!client) return safeSend(chatId, `❌ ${exchange.name}未连接`);

    const result = await gate.getFuturesPositions(client.apiKey, client.secretKey);
    if (result.success && Array.isArray(result.data)) {
      const open = result.data.filter(p => parseFloat(p.size || 0) !== 0);
      if (open.length === 0) return safeSend(chatId, '📭 无持仓');
      const lines = open.map(p =>
        `• ${p.contract}  多仓 \`${p.size}\`  均价 \`${p.entry_price}\`  浮亏 \`${p.unrealized_pnl || 0}\``
      );
      safeSend(chatId, `📊 *永续合约持仓*\n\n${lines.join('\n')}`);
    } else {
      safeSend(chatId, `❌ 查询失败: ${result.error || '未知错误'}`);
    }
  });

  // ── /buy ───────────────────────────────────────────────────────
  bot.onText(/^\/buy\s+(\S+)\s+([\d.]+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!client) return safeSend(chatId, `❌ ${exchange.name}未连接`);

    const symbol = match[1].toUpperCase();
    const quantity = parseFloat(match[2]);
    const contract = symbol.includes('_') ? symbol : `${symbol}_USDT`;

    // 风控
    if (symbol.startsWith('BTC') && quantity > 0.01) {
      return safeSend(chatId, '⚠️ 风控：单笔BTC不超过0.01');
    }
    if (!riskControl.canTrade()) {
      return safeSend(chatId, '⚠️ 当日交易次数已达上限');
    }

    logger.info(`买入: ${contract} ${quantity}`);
    const result = await gate.futuresBuy(contract, quantity, client.apiKey, client.secretKey);

    if (result.success && result.data) {
      riskControl.recordTrade();
      const d = result.data;
      safeSend(chatId,
        `✅ *买入成功（做多）*\n` +
        `• 合约: ${contract}\n` +
        `• 数量: ${quantity}\n` +
        `• 订单ID: \`${d.id || d.order_id || 'N/A'}\`\n` +
        `• 状态: \`${d.status || 'open'}\``
      );
    } else {
      safeSend(chatId, `❌ 买入失败: ${result.error}`);
    }
  });

  // ── /sell ─────────────────────────────────────────────────────
  bot.onText(/^\/sell\s+(\S+)\s+([\d.]+)$/, async (msg, match) => {
    const chatId = msg.chat.id;
    if (!client) return safeSend(chatId, `❌ ${exchange.name}未连接`);

    const symbol = match[1].toUpperCase();
    const quantity = parseFloat(match[2]);
    const contract = symbol.includes('_') ? symbol : `${symbol}_USDT`;

    if (symbol.startsWith('BTC') && quantity > 0.01) {
      return safeSend(chatId, '⚠️ 风控：单笔BTC不超过0.01');
    }
    if (!riskControl.canTrade()) {
      return safeSend(chatId, '⚠️ 当日交易次数已达上限');
    }

    logger.info(`卖出: ${contract} ${quantity}`);
    const result = await gate.futuresSell(contract, quantity, client.apiKey, client.secretKey);

    if (result.success && result.data) {
      riskControl.recordTrade();
      const d = result.data;
      safeSend(chatId,
        `✅ *卖出成功（做空）*\n` +
        `• 合约: ${contract}\n` +
        `• 数量: ${quantity}\n` +
        `• 订单ID: \`${d.id || d.order_id || 'N/A'}\`\n` +
        `• 状态: \`${d.status || 'open'}\``
      );
    } else {
      safeSend(chatId, `❌ 卖出失败: ${result.error}`);
    }
  });

  // ── /status ───────────────────────────────────────────────────
  bot.onText(/^\/status$/, (msg) => {
    const chatId = msg.chat.id;
    const up = process.uptime();
    const upStr = `${Math.floor(up/3600)}h ${Math.floor((up%3600)/60)}m`;
    safeSend(chatId,
      `🤖 *运行状态*\n` +
      `• 交易所: ${exchange.name}\n` +
      `• 运行时间: ${upStr}\n` +
      `• 今日交易: ${riskControl.dailyTradeCount}/${riskControl.maxDailyTrades}\n` +
      `• 剩余交易次数: ${riskControl.remainingTrades()}`
    );
  });

  // ── /help ─────────────────────────────────────────────────────
  bot.onText(/^\/help$/, (msg) => {
    const chatId = msg.chat.id;
    safeSend(chatId,
      `📖 *帮助文档*\n\n` +
      `交易所: ${exchange.name}\n` +
      `合约格式: BTC_USDT (Gate永续)\n\n` +
      `买入做多示例: /buy BTC_USDT 0.001\n` +
      `卖出做空示例: /sell BTC_USDT 0.001\n` +
      `查询价格: /price BTC_USDT\n` +
      `查询余额: /balance\n` +
      `查看持仓: /positions`
    );
  });

  logger.info(`Telegram Bot 初始化完成 (${exchange.name})`);
  return bot;
}

module.exports = { createBot };