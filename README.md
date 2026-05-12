# Gate.io 永续合约 Telegram 交易机器人

> 用Telegram指令控制Gate.io永续合约合约交易，支持测试网/主网切换

## 功能

- 📊 **实时行情** - 查询任意合约价格、买卖深度
- 💰 **市价开仓** - `/buy BTC_USDT 0.001` 做多
- 💰 **市价平仓** - `/sell BTC_USDT 0.001` 做空
- 📋 **持仓查询** - 查看当前仓位、浮盈亏
- 💵 **余额查询** - 现货账户余额
- 🛡️ **风控模块** - 单笔限制 + 每日交易上限

## 支持的交易所

| 交易所 | 网络 | API Base |
|--------|------|----------|
| Gate.io | 主网 | https://api.gateio.xyz |
| Gate.io | 测试网 | https://fx-api-testnet.gateio.xyz |

## 快速开始

### 1. 安装

```bash
git clone https://github.com/lzhao8956-glitch/gate-tg-bot.git
cd gate-tg-bot
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 填入以下内容
```

### 3. 配置说明 (.env)

```env
# Gate.io API密钥（从 https://www.gate.io/zh/my/settings/api_keys 获取）
GATE_API_KEY=your_api_key_here
GATE_SECRET_KEY=your_secret_key_here

# 网络模式: mainnet 或 testnet
GATE_NETWORK=testnet

# Telegram Bot Token（从 @BotFather 获取）
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# 风控：每日最大交易次数
MAX_DAILY_TRADES=50
```

### 4. 启动

```bash
# 测试网模式
npm start

# 主网模式（确认风控参数）
GATE_NETWORK=mainnet npm start
```

## 命令列表

| 命令 | 说明 | 示例 |
|------|------|------|
| `/start` | 显示帮助 | `/start` |
| `/price <合约>` | 查询行情 | `/price BTC_USDT` |
| `/balance` | 查询现货余额 | `/balance` |
| `/positions` | 查看合约持仓 | `/positions` |
| `/buy <合约> <数量>` | 市价做多 | `/buy BTC_USDT 0.001` |
| `/sell <合约> <数量>` | 市价做空 | `/sell BTC_USDT 0.001` |
| `/status` | 运行状态 | `/status` |
| `/help` | 帮助文档 | `/help` |

## 合约格式

Gate.io 永续合约使用 `BASE_QUOTE` 格式：
- `BTC_USDT` - BTC永续合约
- `ETH_USDT` - ETH永续合约
- `SOL_USDT` - SOL永续合约

## 风控规则

- 单笔BTC不超过 0.01 BTC
- 每日交易上限 50 笔（可配置）
- 每日凌晨重置计数

## 项目结构

```
gate-tg-bot/
├── src/
│   ├── index.js          # 主入口
│   ├── exchange/
│   │   ├── binance.js    # 币安接口（保留）
│   │   └── gate.js       # Gate.io API
│   ├── bot/
│   │   └── handlers.js   # TG命令处理器
│   └── utils/
│       └── logger.js      # 日志模块
├── .env.example           # 环境变量模板
├── package.json
└── README.md
```

## 开发

```bash
# 测试网验证连通性
node src/index.js

# 查看日志
tail -f logs/app.log
```

## License

MIT