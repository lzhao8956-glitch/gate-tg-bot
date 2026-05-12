'use strict';

const path = require('path');
const fs = require('fs');
const winston = require('winston');

const logDir = path.resolve(__dirname, '..', '..', 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
      return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
    }),
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `[${timestamp}] [${level}] ${message}${metaStr}`;
        }),
      ),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'app.log'),
      level: 'info', maxsize: 20 * 1024 * 1024, maxFiles: 5,
      format: winston.format.combine(winston.format.uncolorize(), winston.format.json()),
    }),
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error', maxsize: 20 * 1024 * 1024, maxFiles: 10,
      format: winston.format.combine(winston.format.uncolorize(), winston.format.json()),
    }),
  ],
});

module.exports = logger;
