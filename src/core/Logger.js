const fs = require('fs');
const path = require('path');

// 安全地获取 app 对象（可能在某些情况下未定义）
let app = null;
try {
  app = require('electron').app;
} catch (e) {
  // app 对象可能未定义，这没关系，我们会使用 process.cwd() 作为备选
}

/**
 * 日志工具类：同时输出到控制台和文件
 */
class Logger {
  constructor() {
    this.logFile = null;
    this.writeStream = null;
    this.originalConsole = {
      log: console.log.bind(console),
      error: console.error.bind(console),
      warn: console.warn.bind(console),
      info: console.info.bind(console)
    };
    this.initialized = false;
  }

  /**
   * 初始化日志系统
   */
  initialize() {
    try {
      // 如果已经初始化且流还存在，先关闭旧的流
      if (this.writeStream && !this.writeStream.destroyed) {
        this.writeStream.end();
        this.writeStream = null;
      }

      // 确定日志文件路径
      let userDataPath;
      try {
        // 尝试获取 Electron app 的用户数据目录
        if (app && app.isReady && app.isReady()) {
          userDataPath = app.getPath('userData');
        } else if (app && app.getPath) {
          // app 存在但可能还没 ready，尝试直接调用（可能会失败）
          try {
            userDataPath = app.getPath('userData');
          } catch (e) {
            userDataPath = process.cwd();
          }
        } else {
          userDataPath = process.cwd();
        }
      } catch (e) {
        userDataPath = process.cwd();
      }

      const logDir = path.join(userDataPath, 'logs');
      
      // 确保日志目录存在
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const newLogFile = path.join(logDir, 'app.log');
      
      // 如果日志文件路径改变，需要更新
      const isNewFile = this.logFile !== newLogFile;
      this.logFile = newLogFile;
      
      // 创建写入流（追加模式）
      this.writeStream = fs.createWriteStream(this.logFile, { flags: 'a' });

      // 监听错误
      this.writeStream.on('error', (err) => {
        this.originalConsole.error('[Logger] Failed to write to log file:', err);
      });

      // 只在第一次初始化时重写 console 方法
      if (!this.initialized) {
        this.overrideConsole();
      }

      // 写入启动信息（只有在新文件或第一次初始化时）
      if (!this.initialized || isNewFile) {
        const timestamp = new Date().toISOString();
        this.writeToFile(`\n========== Application Started: ${timestamp} ==========\n`);
        this.originalConsole.log(`[Logger] Logging initialized, log file: ${this.logFile}`);
      }

      this.initialized = true;
    } catch (error) {
      this.originalConsole.error('[Logger] Failed to initialize logger:', error);
    }
  }

  /**
   * 格式化日志消息
   */
  formatMessage(args) {
    const timestamp = new Date().toISOString();
    const messages = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          // 对于对象，使用紧凑格式（单行）以提高可读性
          // 但如果对象太大，使用格式化输出
          const jsonStr = JSON.stringify(arg);
          if (jsonStr.length > 500) {
            return JSON.stringify(arg, null, 2);
          }
          return jsonStr;
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    });
    
    return `[${timestamp}] ${messages.join(' ')}\n`;
  }

  /**
   * 写入文件
   */
  writeToFile(message) {
    if (this.writeStream && !this.writeStream.destroyed) {
      this.writeStream.write(message);
    }
  }

  /**
   * 重写 console 方法
   */
  overrideConsole() {
    const self = this;

    // console.log
    console.log = function(...args) {
      self.originalConsole.log(...args);
      const message = self.formatMessage(args);
      self.writeToFile(message);
    };

    // console.error
    console.error = function(...args) {
      self.originalConsole.error(...args);
      const message = self.formatMessage(args);
      self.writeToFile(message);
    };

    // console.warn
    console.warn = function(...args) {
      self.originalConsole.warn(...args);
      const message = self.formatMessage(args);
      self.writeToFile(message);
    };

    // console.info
    console.info = function(...args) {
      self.originalConsole.info(...args);
      const message = self.formatMessage(args);
      self.writeToFile(message);
    };
  }

  /**
   * 清理资源
   */
  shutdown() {
    if (this.writeStream && !this.writeStream.destroyed) {
      const timestamp = new Date().toISOString();
      this.writeToFile(`\n========== Application Shutdown: ${timestamp} ==========\n\n`);
      this.writeStream.end();
    }
    this.initialized = false;
  }

  /**
   * 获取日志文件路径
   */
  getLogFilePath() {
    return this.logFile;
  }
}

// 创建单例
const logger = new Logger();

module.exports = logger;
