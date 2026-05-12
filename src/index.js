'use strict';

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const logger = require('./utils/logger');
const gate = require('./exchange/gate');
const { createBot } = require('./bot/handlers');
const cron = require('node-cron');

// ─── 风控模块 ───────────────────────────────────────────────────
const riskControl = {
  dailyTradeCount: 0,
  maxDailyTrades: parseInt(process.env.MAX_DAILY_TRADES, 10) || 50,
  dailyResetTime: null,

  canTrade() {
    this._checkDailyReset();
    return this.dailyTradeCount < this.maxDailyTrades;
  },

  recordTrade() {
    this._checkDailyReset();
    this.dailyTradeCount++;
    logger.info(`风控: 当日交易次数 ${this.dailyTradeCount}/${this.maxDailyTrades}`);
  },

  remainingTrades() {
    this._checkDailyReset();
    return Math.max(0, this.maxDailyTrades - this.dailyTradeCount);
  },

  _checkDailyReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.dailyResetTime !== today) {
      this.dailyTradeCount = 0;
      this.dailyResetTime = today;
      logger.info('风控: 日交易计数已重置');
    }
  },
};

// ─── 客户端封装 ──────────────────────────────────────────────────
let gateClient = null;
let tgBot = null;

// 测试网模式
const IS_TESTNET = (process.env.GATE_NETWORK || 'mainnet') === 'testnet';

function printBanner() {
  const pkg = require('../package.json');
  const network = IS_TESTNET ? '测试网 (Testnet)' : '主网 (Mainnet)';
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log(`║  Gate.io 永续合约交易机器人 v${pkg.version}  ║`);
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  网络: ${network.padEnd(32)} ║`);
  console.log(`║  Node.js: ${process.version.padEnd(24)} ║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');
}

async function main() {
  printBanner();
  const appName = 'Gate.io永续合约交易机器人';
  logger.info(`${appName} 启动中...`);
  logger.info(`网络模式: ${IS_TESTNET ? '测试网' : '主网'}`);

  // 初始化Gate.io客户端
  const apiKey = process.env.GATE_API_KEY;
  const secretKey = process.env.GATE_SECRET_KEY;

  if (apiKey && secretKey) {
    gateClient = { apiKey, secretKey, testnet: IS_TESTNET };
    logger.info('Gate.io 客户端初始化成功');

    // 验证连通性
    if (IS_TESTNET) {
      const test = await gate.getFuturesContracts(apiKey, secretKey);
      if (test.success) {
        logger.info(`测试网连通成功，当前有 ${test.data?.length || 0} 个合约`);
      } else {
        logger.warn(`测试网连通失败: ${test.error}`);
      }
    }
  } else {
    logger.warn('Gate.io API密钥未配置，仅Telegram Bot可用');
  }

  // 初始化TG Bot
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (botToken) {
    tgBot = createBot(botToken, gateClient, riskControl, logger);
    logger.info('Telegram Bot 初始化成功');
  } else {
    logger.warn('TG Bot Token未配置，TG Bot不可用');
  }

  // 定时状态输出
  const statusJob = cron.schedule('0 * * * *', () => {
    logger.info('定时状态', {
      uptime: process.uptime(),
      dailyTrades: riskControl.dailyTradeCount,
      gateConnected: !!gateClient,
      telegramConnected: !!tgBot,
      network: IS_TESTNET ? 'testnet' : 'mainnet',
    });
  });

  // 优雅退出
  function shutdown(signal) {
    logger.info(`收到 ${signal}，关闭中...`);
    statusJob.stop();
    if (tgBot) tgBot.stopPolling().catch(() => {});
    setTimeout(() => process.exit(0), 500);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => logger.error('未捕获异常', { error: err.message }));
  process.on('unhandledRejection', (reason) => logger.error('未处理Promise拒绝', { reason }));

  logger.info('机器人启动完成，等待指令...');
}

main().catch((err) => {
  logger.error('启动失败', { error: err.message });
  process.exit(1);
});

module.exports = { logger, gateClient, tgBot, riskControl };