# Gate.io 永续合约 TG Bot Docker 部署指南

## 目录

- [概述](#概述)
- [系统要求](#系统要求)
- [快速部署（一键脚本）](#快速部署一键脚本)
- [手动部署](#手动部署)
  - [1. 环境准备](#1-环境准备)
  - [2. 配置.env](#2-配置env)
  - [3. 构建Docker镜像](#3-构建docker镜像)
  - [4. 运行容器](#4-运行容器)
- [systemd 自启动配置](#systemd-自启动配置)
- [监控与报警](#监控与报警)
- [日志管理](#日志管理)
- [更新与维护](#更新与维护)
- [故障排查](#故障排查)

---

## 概述

本项目为 Gate.io 永续合约 Telegram 交易机器人，支持：

- 实时行情查询 (`/price`)
- 现货/合约余额查询 (`/balance`)
- 市价开多/开空 (`/buy` `/sell`)
- 持仓查询 (`/positions`)
- 日交易次数风控（默认每日50笔）
- BTC 单笔交易限额风控（0.01 BTC）
- 测试网 / 主网切换
- 日志持久化

**注意**：本 bot 仅供技术研究使用，实盘交易请自行承担风险。

---

## 系统要求

| 项目 | 要求 |
|------|------|
| 系统 | Ubuntu 20.04+ / Debian 11+ / CentOS 8+ |
| CPU | 1 核及以上 |
| 内存 | 512 MB 及以上 |
| 磁盘 | 5 GB 及以上 |
| Docker | 20.10+ |
| Docker Compose | 2.0+ |
| Node.js（可选，非容器运行） | 18.0+ |

---

## 快速部署（一键脚本）

### 方式一：curl 一键部署（推荐）

```bash
# 在你的 VPS 上以 root 或有 sudo 权限的用户执行
curl -fsSL https://your-repository/raw/main/deploy.sh | bash -s
```

### 方式二：完整一键部署（含 systemd + 监控）

```bash
# 下载并执行
wget -q https://your-repository/raw/main/deploy-full.sh
chmod +x deploy-full.sh
sudo ./deploy-full.sh
```

---

## 手动部署

### 1. 环境准备

#### 1.1 安装 Docker

```bash
# Ubuntu / Debian
apt update && apt install -y ca-certificates curl gnupg lsb-release

# 添加 Docker GPG 密钥
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# 添加 Docker 仓库
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动并设置开机自启
systemctl enable docker
systemctl start docker

# 将当前用户加入 docker 组（免 sudo）
usermod -aG docker $USER
newgrp docker
```

#### 1.2 验证 Docker

```bash
docker --version
docker compose version
```

---

### 2. 配置 .env

在项目根目录创建 `.env` 文件：

```bash
# 克隆项目（如尚未克隆）
git clone https://github.com/your-repo/gate-tg-bot.git /opt/gate-tg-bot
cd /opt/gate-tg-bot

# 复制示例配置
cp .env.example .env
nano .env   # 编辑配置
```

#### 完整 .env 配置示例

```env
# ============================================================
# Gate.io TG Bot 配置文件
# ============================================================

# ----- Telegram Bot -----
# 从 @BotFather 获取的 Bot Token
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyzabcdefghijkl

# 允许使用 Bot 的 Telegram 用户 ID（多个用逗号分隔）
# 留空表示不限制（不推荐）
ALLOWED_USER_IDS=111111111,222222222

# ----- Gate.io API -----
# Gate.io API Key（从 https://www.gate.io/myaccount/apikeymanagement 获取）
# 测试网密钥格式：test-开头
GATE_API_KEY=your_gate_api_key_here
GATE_SECRET_KEY=your_gate_secret_key_here

# 网络模式：mainnet 或 testnet
GATE_NETWORK=mainnet

# ----- 风控配置 -----
# 每日最大交易次数（默认50）
MAX_DAILY_TRADES=50

# ----- 日志配置 -----
# 日志级别：debug | info | warn | error
LOG_LEVEL=info

# ----- 健康监控 Webhook（可选）----
# 当启用监控时，推送报警消息到此 URL
HEALTH_WEBHOOK_URL=https://your-webhook.com/alert

# ----- 高级 -----
# 交易所选择（目前支持 gate）
EXCHANGE=gate
```

#### .env 敏感信息说明

| 变量 | 必填 | 说明 | 安全建议 |
|------|------|------|---------|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot Token | 不要提交到 Git |
| `GATE_API_KEY` | ✅ | API Key | 不要提交到 Git |
| `GATE_SECRET_KEY` | ✅ | Secret Key | 不要提交到 Git |
| `ALLOWED_USER_IDS` | ⚠️ | 用户白名单 | 建议设置 |
| `MAX_DAILY_TRADES` | ❌ | 默认50 | 按需调整 |

---

### 3. 构建 Docker 镜像

#### 3.1 创建 Dockerfile

在项目根目录创建 `Dockerfile`：

```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Stage 2: Production
FROM node:18-alpine

# 安全：创建非 root 用户
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# 从 builder 复制依赖
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package*.json ./

# 复制源码
COPY src ./src

# 创建日志目录并设置权限
RUN mkdir -p /app/logs && chown -R appuser:appgroup /app

# 切换到非 root 用户
USER appuser

# 暴露端口（预留，未来可加健康检查接口）
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# 启动命令
CMD ["node", "src/index.js"]
```

#### 3.2 创建 .dockerignore

```gitignore
# 依赖
node_modules/

# 日志
logs/
*.log

# 环境文件
.env
.env.local
.env.*.local

# Git
.git
.gitignore

# IDE
.idea/
.vscode/
*.swp
*.swo

# Docker
Dockerfile*
docker-compose*.yml
.dockerignore

# 测试
test/
tests/
*.test.js
*.spec.js

# 其他
*.md
!README.md
```

#### 3.3 构建镜像

```bash
cd /opt/gate-tg-bot

# 构建（标签版本号）
docker build -t gate-tg-bot:v0.1.0 .

# 验证镜像
docker images gate-tg-bot
```

---

### 4. 运行容器

#### 4.1 使用 docker run（快速测试）

```bash
# 首次运行
docker run -d \
  --name gate-tg-bot \
  --restart unless-stopped \
  --env-file /opt/gate-tg-bot/.env \
  -v /opt/gate-tg-bot/logs:/app/logs \
  -v /etc/localtime:/etc/localtime:ro \
  --tz=Asia/Shanghai \
  --log-driver json-file \
  --log-opt max-size=10m \
  --log-opt max-file=3 \
  gate-tg-bot:v0.1.0

# 查看日志
docker logs -f gate-tg-bot

# 停止
docker stop gate-tg-bot

# 删除容器
docker rm gate-tg-bot
```

#### 4.2 使用 docker-compose（推荐生产使用）

创建 `docker-compose.yml`：

```yaml
version: '3.8'

services:
  gate-tg-bot:
    image: gate-tg-bot:v0.1.0
    container_name: gate-tg-bot
    restart: unless-stopped
    env_file:
      - .env
    volumes:
      # 日志持久化
      - ./logs:/app/logs
      # 时区同步
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    environment:
      - TZ=Asia/Shanghai
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 30s
    networks:
      - gate-tg-net

networks:
  gate-tg-net:
    driver: bridge
```

```bash
# 启动
docker compose up -d

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f

# 重启
docker compose restart

# 停止
docker compose down
```

---

## systemd 自启动配置

### 1. 创建 systemd Service 文件

```bash
sudo nano /etc/systemd/system/gate-tg-bot.service
```

写入以下内容：

```ini
[Unit]
Description=Gate.io Perpetual Futures Telegram Bot
Documentation=https://github.com/your-repo/gate-tg-bot
After=network.target docker.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes

# 启动命令
ExecStart=/usr/bin/docker start gate-tg-bot
ExecStop=/usr/bin/docker stop gate-tg-bot
ExecRestart=/usr/bin/docker restart gate-tg-bot

# 健康检查重载
ExecReload=/bin/kill -HUP $MAINPID

# 重启策略
Restart=on-failure
RestartSec=10

# 日志输出
StandardOutput=journal
StandardError=journal
SyslogIdentifier=gate-tg-bot

# 用户（可选）
User=root
Group=docker

[Install]
WantedBy=multi-user.target
```

### 2. 启用并启动服务

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启用开机自启
sudo systemctl enable gate-tg-bot.service

# 启动服务
sudo systemctl start gate-tg-bot.service

# 查看状态
sudo systemctl status gate-tg-bot.service

# 查看实时日志
sudo journalctl -u gate-tg-bot.service -f
```

### 3. 管理命令

```bash
# 启动
sudo systemctl start gate-tg-bot

# 停止
sudo systemctl stop gate-tg-bot

# 重启
sudo systemctl restart gate-tg-bot

# 查看状态
sudo systemctl status gate-tg-bot

# 查看日志
sudo journalctl -u gate-tg-bot -f --lines=50

# 检查是否开机自启
sudo systemctl is-enabled gate-tg-bot
```

---

## 监控与报警

### 方案一：Telegram Bot 日志推送（轻量级）

创建一个独立的"监控 Bot"，用于接收报警：

```javascript
// monitor.js - 独立监控脚本，监控 gate-tg-bot 的日志变化
// 将此脚本配合 cron 或 pm2 运行，定时检查日志中的错误

const https = require('https');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = 'YOUR_MONITOR_BOT_TOKEN';
const CHAT_ID = 'YOUR_CHAT_ID';
const LOG_FILE = '/opt/gate-tg-bot/logs/error.log';
const LAST_POS_FILE = '/tmp/gate-tg-bot-monitor.pos';

function sendTelegram(message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      chat_id: CHAT_ID,
      text: message,
      parse_mode: 'Markdown',
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function checkErrors() {
  try {
    const stats = fs.statSync(LOG_FILE);
    const lastPos = fs.existsSync(LAST_POS_FILE)
      ? parseInt(fs.readFileSync(LAST_POS_FILE, 'utf8'), 10)
      : 0;

    if (stats.size <= lastPos) return; // 无新内容

    const stream = fs.createReadStream(LOG_FILE, { start: lastPos });
    let buffer = '';

    stream.on('data', (chunk) => buffer += chunk);
    stream.on('end', async () => {
      fs.writeFileSync(LAST_POS_FILE, stats.size.toString());

      const lines = buffer.split('\n').filter(l => l.includes('ERROR'));
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const msg = `🚨 *Bot报警*\n\`${entry.message}\`\n时间: \`${entry.timestamp}\``;
          await sendTelegram(msg);
        } catch {
          if (buffer.trim()) {
            await sendTelegram(`🚨 *Bot Error*\n\`${buffer.slice(0, 500)}\``);
          }
        }
      }
    });
    stream.on('error', console.error);
  } catch (err) {
    console.error('Monitor error:', err.message);
  }
}

checkErrors();
setInterval(checkErrors, 60000); // 每分钟检查一次
```

### 方案二：Prometheus + Grafana 监控（生产级）

#### 2.1 安装 Prometheus

```bash
# docker-compose.yml 中添加
  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'

volumes:
  prometheus-data:
```

#### 2.2 prometheus.yml 配置

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

alerting:
  alertmanagers:
    - static_configs:
        - targets: []

rule_files:
  - "alert.rules.yml"

scrape_configs:
  - job_name: 'gate-tg-bot'
    static_configs:
      - targets: ['host.docker.internal:3000']  # 需要容器暴露健康检查端口
    metrics_path: /metrics
```

#### 2.3 告警规则 alert.rules.yml

```yaml
groups:
  - name: gate-tg-bot-alerts
    rules:
      - alert: BotDown
        expr: up{job="gate-tg-bot"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Gate TG Bot 已宕机"
          description: "Bot 已经停止运行超过 1 分钟"

      - alert: HighErrorRate
        expr: rate(log_messages_total{level="error"}[5m]) > 0.1
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Bot 错误率偏高"
          description: "最近 5 分钟错误率超过 10%"

      - alert: DailyTradeLimitReached
        expr: gate_daily_trades >= gate_max_daily_trades
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "当日交易次数已达上限"
```

### 方案三：使用 Uptime Kuma 自监控（最简单）

```bash
# 创建一个简单的健康检查端点，在 src/index.js 中添加：
# app.get('/health', (req, res) => {
#   res.json({ status: 'ok', uptime: process.uptime() });
# });

# 然后在 Uptime Kuma 中添加监控：
# - 监控类型：HTTP(s)
# - URL: http://your-vps-ip:3000/health
# - 监控间隔：1 分钟
# - 告警渠道：Telegram / Email / Pushover
```

---

## 日志管理

### 日志文件位置

容器内日志挂载到宿主机的 `/opt/gate-tg-bot/logs/`：

```
/opt/gate-tg-bot/
├── logs/
│   ├── app.log       # 应用日志（info + warn + error）
│   └── error.log     # 错误日志（仅 error）
```

### 日志轮转（logrotate）

创建 `/etc/logrotate.d/gate-tg-bot`：

```bash
/opt/gate-tg-bot/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root docker
    sharedscripts
    postrotate
        docker restart gate-tg-bot > /dev/null 2>&1 || true
    endscript
}
```

### 日志分析常用命令

```bash
# 实时查看应用日志
tail -f /opt/gate-tg-bot/logs/app.log

# 实时查看错误日志
tail -f /opt/gate-tg-bot/logs/error.log

# 搜索错误
grep "ERROR" /opt/gate-tg-bot/logs/app.log | tail -50

# 统计错误数量
grep -c "ERROR" /opt/gate-tg-bot/logs/app.log

# 搜索特定交易操作
grep "买入\|卖出" /opt/gate-tg-bot/logs/app.log

# Docker 日志
docker logs gate-tg-bot --since "1h" | grep ERROR
```

---

## 更新与维护

### 更新流程

```bash
cd /opt/gate-tg-bot

# 1. 拉取最新代码
git pull origin main

# 2. 重新构建镜像
docker build -t gate-tg-bot:v0.1.1 .

# 3. 停止旧容器
docker compose down

# 4. 更新 docker-compose.yml 中的镜像版本
sed -i 's/gate-tg-bot:v0.1.0/gate-tg-bot:v0.1.1/' docker-compose.yml

# 5. 启动新容器
docker compose up -d

# 6. 确认运行正常
docker compose logs -f
```

### 数据库/状态持久化

- 日志目录已通过 `-v` 挂载到宿主机
- 风控计数（每日交易次数）在容器重启后会重置，这是设计行为
- 无其他持久化状态依赖

### 回滚

```bash
# 回滚到上一个版本
docker pull gate-tg-bot:v0.1.0
docker compose down
# 修改 docker-compose.yml 中的版本
docker compose up -d
```

---

## 故障排查

### 常见问题

#### 1. 容器启动失败

```bash
# 查看详细日志
docker logs gate-tg-bot --tail 100

# 检查 .env 文件是否存在且格式正确
cat /opt/gate-tg-bot/.env

# 检查端口是否被占用
netstat -tlnp | grep 3000
```

#### 2. Telegram Bot 无响应

```bash
# 确认 Bot Token 正确
grep TELEGRAM_BOT_TOKEN /opt/gate-tg-bot/.env

# 测试 Bot API 连通性
curl -s https://api.telegram.org/bot<YOUR_TOKEN>/getMe

# 检查 Bot 是否被 Ban
curl -s https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
```

#### 3. Gate.io API 连接失败

```bash
# 测试 API 连通性
curl -s -o /dev/null -w "%{http_code}" https://api.gateio.xyz/api/v4

# 检查 API Key 是否有效（测试网 vs 主网）
# 确保 GATE_NETWORK 设置与密钥匹配
grep GATE_NETWORK /opt/gate-tg-bot/.env

# 查看 API 相关日志
grep -i "gate\|api" /opt/gate-tg-bot/logs/app.log | tail -30
```

#### 4. docker compose up -d 报权限错误

```bash
# 修改项目目录权限
sudo chown -R $USER:$USER /opt/gate-tg-bot
```

#### 5. systemd 服务启动失败

```bash
# 查看详细日志
sudo journalctl -u gate-tg-bot.service -xe

# 检查 docker 是否正常运行
sudo systemctl status docker

# 手动启动容器测试
docker start gate-tg-bot
```

#### 6. 内存不足（OOM）

```bash
# 限制容器内存
docker run -m 512m --memory-swap 512m ...

# 或在 docker-compose.yml 中：
#    deploy:
#      resources:
#        limits:
#          memory: 512M
```

### 安全检查清单

- [ ] `.env` 文件不在 Git 仓库中
- [ ] API Key 和 Secret 不在代码中硬编码
- [ ] `ALLOWED_USER_IDS` 已设置（限制 Bot 使用者）
- [ ] 防火墙仅开放必要端口（SSH、Telegram Bot 端口）
- [ ] 定期更新 Docker 镜像基础系统补丁
- [ ] 使用 Docker 网络隔离

---

## 项目架构回顾

```
gate-tg-bot/
├── src/
│   ├── index.js              # 主入口 + 风控 + 定时任务
│   ├── exchange/
│   │   ├── gate.js          # Gate.io API v4 客户端（永续+现货）
│   │   └── binance.js       # 币安接口（预留）
│   ├── bot/
│   │   └── handlers.js       # Telegram 命令处理器
│   └── utils/
│       └── logger.js         # Winston 日志（控制台+文件）
├── logs/                     # 日志目录（挂载持久化）
├── .env                      # 配置文件（不提交）
├── Dockerfile                # Docker 镜像构建
├── docker-compose.yml        # 容器编排
├── package.json
└── DEPLOY_GUIDE.md          # 本文档
```

### 交易流程（handlers.js）

```
用户发送 /buy BTC_USDT 0.001
       ↓
   输入校验（正数检查）
       ↓
   风控检查（每日次数 + BTC单笔限额）
       ↓
   gate.futuresBuy() → Gate.io API v4
       ↓
   成功 → riskControl.recordTrade() → TG 消息确认
   失败 → TG 消息错误提示
```

---

*最后更新：2026-05-14*
