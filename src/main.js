const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

// 首先初始化日志系统（必须在其他模块之前）
const logger = require('./core/Logger');
logger.initialize();

const AgentManager = require('./core/AgentManager');
const Context = require('./core/Context');
const MessageHistory = require('./core/MessageHistory');
const Agent = require('./core/Agent');
const LsTool = require('./core/tools/LsTool');
const ReadFileTool = require('./core/tools/ReadFileTool');
const SearchTextTool = require('./core/tools/SearchTextTool');
const SearchFileTool = require('./core/tools/SearchFileTool');
const FileInfoTool = require('./core/tools/FileInfoTool');

let mainWindow = null;
let settingsWindow = null;

// 存储应用状态
const appState = {
  workDirectory: null,
  recentDirectories: [],
  settings: {
    apiKey: '',
    apiUrl: 'https://api.openai.com/v1',
    model: '',
    httpProxy: '',
    httpsProxy: '',
    noProxy: '',
    maxContextLength: 16384
  }
};

// 加载配置
async function loadConfig() {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    const data = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(data);
    appState.settings = { ...appState.settings, ...config.settings };
    appState.workDirectory = config.workDirectory || null;
    appState.recentDirectories = config.recentDirectories || [];
  } catch (error) {
    // 配置文件不存在或读取失败，使用默认值
    appState.recentDirectories = [];
  }
}

// 保存配置
async function saveConfig() {
  try {
    const configPath = path.join(app.getPath('userData'), 'config.json');
    await fs.writeFile(configPath, JSON.stringify({
      settings: appState.settings,
      workDirectory: appState.workDirectory,
      recentDirectories: appState.recentDirectories || []
    }, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// 更新最近目录列表
function updateRecentDirectories(directory) {
  if (!directory) return;
  
  // 移除已存在的相同目录
  appState.recentDirectories = (appState.recentDirectories || []).filter(dir => dir !== directory);
  
  // 将新目录添加到最前面
  appState.recentDirectories.unshift(directory);
  
  // 只保留最近5个
  appState.recentDirectories = appState.recentDirectories.slice(0, 5);
  
  // 保存配置
  saveConfig();
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false, // 去掉系统级边框
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 等待页面加载完成后再允许交互
  mainWindow.webContents.once('did-finish-load', () => {
    console.log('Main window loaded successfully');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 监听渲染进程错误
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });

  // 设置渲染进程日志监听（使用新的函数）
  setupRendererLogging(mainWindow.webContents);
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 900,
    height: 600,
    minHeight: 500,
    minWidth: 700,
    parent: mainWindow,
    modal: false, // 改为 false，允许点击外部区域
    frame: false, // 去掉标题栏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  settingsWindow.loadFile(path.join(__dirname, 'renderer', 'settings.html'));

  // 设置设置窗口的日志监听
  setupRendererLogging(settingsWindow.webContents);

  // 保持设置窗口在失焦时不自动关闭，避免切换窗口或点击外部导致关闭

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// 添加关闭设置窗口的 IPC handler
ipcMain.handle('close-settings-window', () => {
  if (settingsWindow) {
    settingsWindow.close();
  }
});

// IPC Handlers
ipcMain.handle('get-app-state', () => {
  return appState;
});

ipcMain.handle('select-work-directory', async () => {
  try {
    // 确保主窗口存在
    if (!mainWindow) {
      console.error('Main window is not available');
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: '选择工作目录'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const newWorkDirectory = result.filePaths[0];
      
      // 如果切换了工作目录，需要清理当前会话管理器
      if (appState.workDirectory !== newWorkDirectory) {
        // 清理旧工作目录的会话管理器
        Object.keys(sessionManagers).forEach(sessionId => {
          delete sessionManagers[sessionId];
        });
        console.log('[Main] Cleared session managers due to work directory change');
      }
      
      appState.workDirectory = newWorkDirectory;
      updateRecentDirectories(newWorkDirectory);
      await saveConfig();
      return appState.workDirectory;
    }
    return null;
  } catch (error) {
    console.error('Error in select-work-directory:', error);
    throw error;
  }
});

ipcMain.handle('get-work-directory', () => {
  return appState.workDirectory;
});

ipcMain.handle('get-recent-directories', () => {
  return appState.recentDirectories || [];
});

ipcMain.handle('switch-work-directory', async (event, directory) => {
  try {
    if (!directory) {
      return false;
    }
    
    // 如果切换了工作目录，需要清理当前会话管理器
    if (appState.workDirectory !== directory) {
      // 清理旧工作目录的会话管理器
      Object.keys(sessionManagers).forEach(sessionId => {
        delete sessionManagers[sessionId];
      });
      console.log('[Main] Cleared session managers due to work directory change');
    }
    
    appState.workDirectory = directory;
    updateRecentDirectories(directory);
    await saveConfig();
    return true;
  } catch (error) {
    console.error('Error in switch-work-directory:', error);
    throw error;
  }
});

ipcMain.handle('open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('get-settings', () => {
  return appState.settings;
});

// 窗口控制
ipcMain.handle('window-minimize', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  if (mainWindow) {
    mainWindow.close();
  }
});

ipcMain.handle('save-settings', async (event, settings) => {
  appState.settings = { ...appState.settings, ...settings };
  await saveConfig();
  
  // 清理所有sessionManagers，确保下次使用时使用新设置
  Object.keys(sessionManagers).forEach(sessionId => {
    delete sessionManagers[sessionId];
  });
  console.log('[Main] Cleared session managers due to settings update');
  
  return true;
});

ipcMain.handle('get-models', async (event) => {
  const { apiUrl, apiKey, httpProxy, httpsProxy } = appState.settings;
  if (!apiUrl || !apiKey) {
    return [];
  }

  try {
    const axios = require('axios');
    const https = require('https');
    const http = require('http');
    
    // 配置代理
    const proxyConfig = {};
    if (httpsProxy) {
      proxyConfig.httpsAgent = new https.Agent({
        proxy: httpsProxy
      });
    }
    if (httpProxy) {
      proxyConfig.httpAgent = new http.Agent({
        proxy: httpProxy
      });
    }

    const url = `${apiUrl}/models`;
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      ...proxyConfig,
      timeout: 5000
    });

    // 提取模型列表（OpenAI格式）
    if (response.data && response.data.data) {
      return response.data.data.map(model => ({
        id: model.id,
        name: model.id
      }));
    }
    return [];
  } catch (error) {
    console.error('Failed to fetch models:', error);
    return [];
  }
});

app.whenReady().then(async () => {
  // 应用准备就绪后，重新初始化日志系统以使用正确的用户数据目录
  logger.initialize();
  console.log('[Main] Application ready, log file:', logger.getLogFilePath());
  
  await loadConfig();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出时关闭日志流
app.on('before-quit', () => {
  console.log('[Main] Application shutting down...');
  logger.shutdown();
});

// 获取工作目录的hash值，用于区分不同工作目录的会话
function getWorkDirectoryHash(workDirectory) {
  if (!workDirectory) {
    return 'default';
  }
  return crypto.createHash('md5').update(workDirectory).digest('hex').substring(0, 8);
}

// 获取会话存储路径（基于工作目录）
function getSessionsPath(workDirectory) {
  const hash = getWorkDirectoryHash(workDirectory);
  return path.join(app.getPath('userData'), 'sessions', hash);
}

// 保存会话数据
ipcMain.handle('save-session', async (event, sessionId, sessionData) => {
  try {
    const sessionsPath = getSessionsPath(appState.workDirectory);
    await fs.mkdir(sessionsPath, { recursive: true });
    const sessionFile = path.join(sessionsPath, `${sessionId}.json`);
    await fs.writeFile(sessionFile, JSON.stringify(sessionData, null, 2));
    return true;
  } catch (error) {
    console.error('Failed to save session:', error);
    return false;
  }
});

ipcMain.handle('load-session', async (event, sessionId) => {
  try {
    const sessionsPath = getSessionsPath(appState.workDirectory);
    const sessionFile = path.join(sessionsPath, `${sessionId}.json`);
    const data = await fs.readFile(sessionFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
});

ipcMain.handle('list-sessions', async () => {
  try {
    const sessionsPath = getSessionsPath(appState.workDirectory);
    await fs.mkdir(sessionsPath, { recursive: true });
    const files = await fs.readdir(sessionsPath);
    const sessions = [];
    
    for (const file of files.filter(file => file.endsWith('.json'))) {
      const sessionId = file.replace('.json', '');
      try {
        const sessionFile = path.join(sessionsPath, file);
        const data = await fs.readFile(sessionFile, 'utf-8');
        const sessionData = JSON.parse(data);
        sessions.push({
          id: sessionId,
          title: sessionData.title || '新会话',
          createdAt: sessionData.createdAt || parseInt(sessionId.split('_')[1]) || Date.now(),
          updatedAt: sessionData.updatedAt || parseInt(sessionId.split('_')[1]) || Date.now()
        });
      } catch (error) {
        console.error(`[Main] Failed to load session metadata for ${sessionId}:`, error);
        // 如果读取失败，仍然返回基本信息
        sessions.push({
          id: sessionId,
          title: '新会话',
          createdAt: parseInt(sessionId.split('_')[1]) || Date.now(),
          updatedAt: parseInt(sessionId.split('_')[1]) || Date.now()
        });
      }
    }
    
    // 按更新时间倒序排列
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions;
  } catch (error) {
    return [];
  }
});

ipcMain.handle('delete-session', async (event, sessionId) => {
  try {
    const sessionsPath = getSessionsPath(appState.workDirectory);
    const sessionFile = path.join(sessionsPath, `${sessionId}.json`);
    await fs.unlink(sessionFile);
    
    // 清理内存中的会话管理器
    if (sessionManagers[sessionId]) {
      delete sessionManagers[sessionId];
    }
    
    return true;
  } catch (error) {
    console.error('Failed to delete session:', error);
    return false;
  }
});

// 存储每个会话的AgentManager和Context
const sessionManagers = {};
const toolCallHandlers = {}; // 存储工具调用处理器
const taskCancellations = {}; // 存储每个会话的取消标志

function getSessionManager(sessionId) {
  // 检查是否需要重新创建sessionManager（workDirectory改变或不存在）
  const existing = sessionManagers[sessionId];
  if (!existing || existing.workDirectory !== appState.workDirectory) {
    if (existing) {
      console.log('[Main] Recreating session manager due to workDirectory change', { 
        sessionId, 
        oldWorkDirectory: existing.workDirectory,
        newWorkDirectory: appState.workDirectory 
      });
    } else {
      console.log('[Main] Creating new session manager', { sessionId });
    }
    
    // 确保workDirectory存在
    if (!appState.workDirectory) {
      throw new Error('工作目录未设置，请先选择工作目录');
    }
    
    // 创建所有可用工具
    const allTools = [
      new LsTool(appState.workDirectory),
      new ReadFileTool(appState.workDirectory),
      new SearchTextTool(appState.workDirectory),
      new SearchFileTool(appState.workDirectory),
      new FileInfoTool(appState.workDirectory)
    ];
    
    // 根据设置中的enabledTools过滤工具
    const enabledTools = appState.settings.enabledTools || [];
    let tools = allTools;
    if (enabledTools.length > 0) {
      // 如果设置了enabledTools，只使用被选中的工具
      const enabledToolsSet = new Set(enabledTools);
      tools = allTools.filter(tool => enabledToolsSet.has(tool.name));
    }
    
    sessionManagers[sessionId] = {
      manager: new AgentManager(appState.settings, appState.workDirectory, tools),
      context: new Context(),
      history: new MessageHistory(),
      workDirectory: appState.workDirectory // 保存当前workDirectory以便检查
    };
    console.log('[Main] Session manager created', { 
      sessionId, 
      hasManager: !!sessionManagers[sessionId].manager,
      workDirectory: appState.workDirectory
    });
  }
  return sessionManagers[sessionId];
}

/**
 * 生成会话标题
 * @param {Array} messages - 消息历史（最新一轮对话）
 * @param {string} oldTitle - 旧的标题（如果有）
 * @returns {Promise<string>} - 生成的标题
 */
async function generateSessionTitle(messages, oldTitle = null) {
  try {
    // 如果没有API密钥或模型，返回默认标题
    if (!appState.settings.apiKey || !appState.settings.model) {
      return oldTitle || '新会话';
    }

    // 创建一个简单的Agent来生成标题
    const titleAgent = new Agent(appState.settings);

    // 构建提示
    let prompt = '';
    if (oldTitle) {
      // 如果有旧标题，需要合并生成新标题
      prompt = `你是一个会话标题生成助手。根据以下对话内容和旧标题，生成一个简短（不超过15个字）的概括性标题。

旧标题：${oldTitle}

对话内容：
${messages.map(msg => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content.substring(0, 500)}`).join('\n')}

请生成一个新的标题，应该能够概括旧标题和当前对话的内容。只返回标题文本，不要其他内容。`;
    } else {
      // 首次生成标题
      prompt = `你是一个会话标题生成助手。根据以下对话内容，生成一个简短（不超过15个字）的标题。

对话内容：
${messages.map(msg => `${msg.role === 'user' ? '用户' : 'AI'}: ${msg.content.substring(0, 500)}`).join('\n')}

请生成一个简洁的标题，只返回标题文本，不要其他内容。`;
    }

    const systemPrompt = '你是一个会话标题生成助手。你的任务是根据对话内容生成简洁、准确的标题。标题应该不超过15个字，能够准确概括对话的主题。';

    const result = await titleAgent.callChat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]);

    const title = result.choices[0].message.content.trim();
    // 移除可能的引号或多余符号
    return title.replace(/^["']|["']$/g, '').substring(0, 30);
  } catch (error) {
    console.error('[Main] Failed to generate session title:', error);
    // 如果生成失败，返回默认标题
    return oldTitle || '新会话';
  }
}

// 停止任务
ipcMain.handle('stop-message', async (event, sessionId) => {
  console.log('[Main] stop-message handler called', { sessionId });
  
  // 设置取消标志（如果任务存在）
  if (taskCancellations[sessionId]) {
    taskCancellations[sessionId].cancelled = true;
    console.log('[Main] Task cancellation flag set', { sessionId });
  } else {
    // 即使任务不存在，也创建一个取消标志，以防任务即将开始
    taskCancellations[sessionId] = { cancelled: true };
    console.log('[Main] Pre-emptive cancellation flag set', { sessionId });
  }
  
  // 发送停止信号到渲染进程
  if (event.sender && !event.sender.isDestroyed()) {
    event.sender.send('message-chunk', {
      type: 'stopped'
    });
  }
  
  return { success: true };
});

// 处理消息发送（流式）
ipcMain.handle('send-message', async (event, message, sessionId) => {
  console.log('[Main] send-message handler called', { message, sessionId, hasWorkDirectory: !!appState.workDirectory });
  
  if (!appState.workDirectory) {
    console.error('[Main] send-message failed: no work directory');
    throw new Error('请先选择工作目录');
  }

  // 检查是否已经被取消
  if (taskCancellations[sessionId] && taskCancellations[sessionId].cancelled) {
    console.log('[Main] Task was cancelled before starting');
    delete taskCancellations[sessionId];
    event.sender.send('message-chunk', { type: 'stopped' });
    return { success: false, cancelled: true };
  }
  
  // 初始化取消控制器
  taskCancellations[sessionId] = { cancelled: false };

  const { manager, context, history } = getSessionManager(sessionId);
  console.log('[Main] Got session manager', { hasManager: !!manager, hasContext: !!context, hasHistory: !!history });
  
  // 加载会话历史
  let sessionData = null;
  try {
    const sessionsPath = getSessionsPath(appState.workDirectory);
    const sessionFile = path.join(sessionsPath, `${sessionId}.json`);
    console.log('[Main] Loading session data', { sessionFile });
    const data = await fs.readFile(sessionFile, 'utf-8');
    sessionData = JSON.parse(data);
    console.log('[Main] Session data loaded', { hasHistory: !!sessionData.history, hasContext: !!sessionData.context });
  } catch (error) {
    console.log('[Main] No existing session data found or error loading', { error: error.message });
    sessionData = null;
  }
  
  if (sessionData) {
    if (sessionData.history) {
      console.log('[Main] Loading history from session data');
      history.fromJSON(sessionData.history);
    }
    if (sessionData.context) {
      console.log('[Main] Loading context from session data');
      context.fromJSON(sessionData.context);
    }
  }
  
  // 处理消息
  try {
    let assistantContent = '';
    let chunkCount = 0;
    let contentChunkCount = 0;
    let thinkingContent = ''; // 收集思考内容
    let todos = null; // 保存TODO列表
    let reflection = null; // 保存反思结果
    
    console.log('[Main] Starting processMessage stream', { message, sessionId });
    // 先记录用户消息到历史，确保保存和重载时顺序正确（先user后assistant）
    history.addMessage('user', message);
    
    for await (const chunk of manager.processMessage(message, context, history, async (toolName, args) => {
      // 检查取消标志
      if (taskCancellations[sessionId] && taskCancellations[sessionId].cancelled) {
        console.log('[Main] Task cancelled during tool call');
        throw new Error('任务已停止');
      }
      console.log('[Main] Tool call requested', { toolName, args });
      
      // 工具调用 - 使用当前的workDirectory确保正确
      if (!appState.workDirectory) {
        throw new Error('工作目录未设置，请先选择工作目录');
      }
      
      const tools = [
        new LsTool(appState.workDirectory), 
        new ReadFileTool(appState.workDirectory),
        new SearchTextTool(appState.workDirectory),
        new SearchFileTool(appState.workDirectory)
      ];
      const tool = tools.find(t => t.name === toolName);
      if (!tool) {
        console.error('[Main] Unknown tool', { toolName, availableTools: tools.map(t => t.name) });
        throw new Error(`Unknown tool: ${toolName}`);
      }
      
      // 执行工具调用（操作池的更新已经在 tool_call_start 和 tool_call_result 的 chunk 处理中完成）
      console.log('[Main] Executing tool', { toolName, args, workDirectory: appState.workDirectory });
      
      const result = await tool.execute(args);
      console.log('[Main] Tool executed', { toolName, resultLength: JSON.stringify(result).length });
      
      return result;
    })) {
      // 检查取消标志
      if (taskCancellations[sessionId] && taskCancellations[sessionId].cancelled) {
        console.log('[Main] Task cancelled, stopping stream');
        event.sender.send('message-chunk', { type: 'stopped' });
        // 清理取消标志
        delete taskCancellations[sessionId];
        return { success: false, cancelled: true };
      }
      
      chunkCount++;
      
      // 发送chunk到渲染进程
      console.log('[Main] Sending chunk to renderer', { 
        chunkNumber: chunkCount, 
        type: chunk.type, 
        status: chunk.status,
        hasContent: !!chunk.content,
        contentLength: chunk.content ? chunk.content.length : 0
      });
      
      event.sender.send('message-chunk', chunk);
      
      // 收集并更新context数据
      if (chunk.type === 'thinking') {
        if (chunk.status === 'update' || chunk.status === 'delta') {
          // 流式更新思考内容
          if (chunk.content) {
            thinkingContent += chunk.content;
          }
        } else if (chunk.status === 'complete') {
          // 思考完成，更新到context（complete状态可能没有content，使用已收集的内容）
          if (chunk.content) {
            thinkingContent += chunk.content;
          }
          // 保存已收集的思考内容到context
          if (thinkingContent) {
            context.setThinking(thinkingContent);
            console.log('[Main] Thinking content saved to context', { length: thinkingContent.length });
          }
        }
      } else if (chunk.type === 'planning') {
        if (chunk.status === 'complete' && chunk.todos) {
          // 规划完成，更新TODO列表到context
          // 确保每个TODO都有status字段，默认为'pending'
          todos = chunk.todos.map(t => ({
            ...t,
            status: t.status || 'pending'
          }));
          context.setTodos(todos);
          console.log('[Main] Todos saved to context', { count: todos.length });
        }
      } else if (chunk.type === 'reflection') {
        if (chunk.status === 'complete' && chunk.reflection) {
          // 反思完成，添加到context
          reflection = chunk.reflection;
          context.addReflection(reflection);
          console.log('[Main] Reflection saved to context', { type: reflection.type });
        }
      } else if (chunk.type === 'todo_start') {
        // TODO开始执行，更新状态为running
        if (chunk.todo && chunk.todo.title && todos) {
          const todo = todos.find(t => t.title === chunk.todo.title);
          if (todo) {
            todo.status = 'running';
            context.setTodos(todos); // 更新context中的todos
            console.log('[Main] Todo status updated to running', { title: todo.title });
          }
        }
      } else if (chunk.type === 'todo_complete') {
        // TODO完成，更新状态为completed
        if (chunk.todo && chunk.todo.title && todos) {
          const todo = todos.find(t => t.title === chunk.todo.title);
          if (todo) {
            todo.status = 'completed';
            context.setTodos(todos); // 更新context中的todos
            console.log('[Main] Todo status updated to completed', { title: todo.title });
          }
        }
      } else if (chunk.type === 'tool_call_start') {
        // 工具调用开始，添加操作到操作池
        if (chunk.toolCall) {
          // 如果 chunk 中没有 displayName，从工具实例中获取（作为备用）
          if (!chunk.toolCall.displayName) {
            const tools = [
              new LsTool(appState.workDirectory),
              new ReadFileTool(appState.workDirectory),
              new SearchTextTool(appState.workDirectory),
              new SearchFileTool(appState.workDirectory)
            ];
            const toolInstance = tools.find(t => t.name === chunk.toolCall.name);
            if (toolInstance) {
              chunk.toolCall.displayName = toolInstance.displayName;
            }
          }
          
          const operation = {
            id: chunk.toolCall.id,
            tool: chunk.toolCall.name,
            args: chunk.toolCall.arguments || {},
            result: null,
            timestamp: Date.now()
          };
          context.addOperation(operation);
          console.log('[Main] Operation added to pool', { id: operation.id, tool: operation.tool });
        }
      } else if (chunk.type === 'tool_call_result') {
        // 工具调用结果返回，更新操作池中的操作
        if (chunk.toolCallId && chunk.result !== undefined) {
          const operationPool = context.operationPool || [];
          const operation = operationPool.find(op => op.id === chunk.toolCallId);
          if (operation) {
            operation.result = chunk.result;
            console.log('[Main] Operation result updated in pool', { id: chunk.toolCallId });
          } else {
            console.warn('[Main] Operation not found in pool when updating result', { toolCallId: chunk.toolCallId });
          }
        }
      } else if (chunk.type === 'tool_call_error') {
        // 工具调用错误，更新操作池中的操作
        if (chunk.toolCallId && chunk.error) {
          const operationPool = context.operationPool || [];
          const operation = operationPool.find(op => op.id === chunk.toolCallId);
          if (operation) {
            operation.result = { error: chunk.error };
            console.log('[Main] Operation error result updated in pool', { id: chunk.toolCallId, error: chunk.error });
          } else {
            console.warn('[Main] Operation not found in pool when updating error', { toolCallId: chunk.toolCallId });
          }
        }
      } else if (chunk.type === 'content') {
        contentChunkCount++;
        assistantContent += chunk.content;
        console.log('[Main] Content chunk received', { 
          chunkNumber: contentChunkCount, 
          chunkLength: chunk.content.length, 
          totalLength: assistantContent.length 
        });
      }
    }
    
    // 检查是否被取消
    if (taskCancellations[sessionId] && taskCancellations[sessionId].cancelled) {
      console.log('[Main] Task was cancelled, skipping save');
      delete taskCancellations[sessionId];
      return { success: false, cancelled: true };
    }
    
    console.log('[Main] ProcessMessage stream completed', { 
      totalChunks: chunkCount, 
      contentChunks: contentChunkCount, 
      totalContentLength: assistantContent.length
    });
    
    // 清理取消标志
    delete taskCancellations[sessionId];
    
    // 保存会话历史
    console.log('[Main] Saving session history');
    // 添加assistant回复（需要从流中收集完整内容）
    // 注意：这里需要从流中收集完整的assistant回复
    const sessionsPath = getSessionsPath(appState.workDirectory);
    await fs.mkdir(sessionsPath, { recursive: true });
    const sessionFile = path.join(sessionsPath, `${sessionId}.json`);
    
    // 加载现有会话数据以获取标题
    let existingSessionData = null;
    try {
      const existingData = await fs.readFile(sessionFile, 'utf-8');
      existingSessionData = JSON.parse(existingData);
    } catch (error) {
      // 文件不存在，这是新会话
    }
    
    // 获取最新一轮对话（用户消息和AI回复）
    const historyMessages = history.getMessagesForInference(false);
    const latestMessages = [];
    if (historyMessages.length >= 2) {
      // 获取最后两条消息（用户和AI）
      latestMessages.push(historyMessages[historyMessages.length - 2]);
      latestMessages.push(historyMessages[historyMessages.length - 1]);
    } else if (historyMessages.length === 1) {
      latestMessages.push(historyMessages[0]);
    }
    
    // 生成或更新标题
    let sessionTitle = existingSessionData?.title || null;
    if (latestMessages.length >= 2) {
      // 有新的一轮对话，生成标题
      sessionTitle = await generateSessionTitle(latestMessages, sessionTitle);
    } else if (!sessionTitle) {
      // 如果没有标题且没有完整对话，使用默认标题
      sessionTitle = '新会话';
    }
    
    await fs.writeFile(sessionFile, JSON.stringify({
      title: sessionTitle,
      history: history.toJSON(),
      context: context.toJSON(),
      createdAt: existingSessionData?.createdAt || Date.now(),
      updatedAt: Date.now()
    }, null, 2));
    
    console.log('[Main] Session saved', { sessionFile, assistantContentLength: assistantContent.length, title: sessionTitle });
    
    return { success: true };
  } catch (error) {
    console.error('[Main] Error in send-message handler', { error: error.message, stack: error.stack });
    
    // 清理取消标志
    if (taskCancellations[sessionId]) {
      delete taskCancellations[sessionId];
    }
    
    // 如果是取消错误，发送停止信号而不是错误信号
    if (error.message === '任务已停止' || error.message.includes('cancelled')) {
      event.sender.send('message-chunk', {
        type: 'stopped'
      });
      return { success: false, cancelled: true };
    }
    
    event.sender.send('message-chunk', {
      type: 'error',
      error: error.message
    });
    throw error;
  }
});

// 工具调用
ipcMain.handle('call-tool', async (event, toolName, args) => {
  if (!appState.workDirectory) {
    throw new Error('工作目录未设置，请先选择工作目录');
  }
  
  // 创建所有可用工具
  const allTools = [
    new LsTool(appState.workDirectory),
    new ReadFileTool(appState.workDirectory),
    new SearchTextTool(appState.workDirectory),
    new SearchFileTool(appState.workDirectory),
    new FileInfoTool(appState.workDirectory)
  ];
  
  // 根据设置中的enabledTools过滤工具
  const enabledTools = appState.settings.enabledTools || [];
  let tools = allTools;
  if (enabledTools.length > 0) {
    const enabledToolsSet = new Set(enabledTools);
    tools = allTools.filter(tool => enabledToolsSet.has(tool.name));
  }
  
  const tool = tools.find(t => t.name === toolName);
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName} (可能已被禁用)`);
  }
  
  console.log('[Main] call-tool executing', { toolName, args, workDirectory: appState.workDirectory });
  return await tool.execute(args);
});

// 列出可用工具（仅名称与展示名）
ipcMain.handle('list-tools', async () => {
  const tools = [
    new LsTool(appState.workDirectory || '/'),
    new ReadFileTool(appState.workDirectory || '/'),
    new SearchTextTool(appState.workDirectory || '/'),
    new SearchFileTool(appState.workDirectory || '/'),
    new FileInfoTool(appState.workDirectory || '/')
  ];
  return tools.map(t => ({
    name: t.name,
    displayName: t.displayName,
    description: t.description,
    schema: t.schema
  }));
});

// 处理渲染进程的日志（转发到主进程的日志系统）
ipcMain.handle('renderer-log', (event, level, args) => {
  const prefix = '[Renderer]';
  switch (level) {
    case 'log':
      console.log(prefix, ...args);
      break;
    case 'error':
      console.error(prefix, ...args);
      break;
    case 'warn':
      console.warn(prefix, ...args);
      break;
    case 'info':
      console.info(prefix, ...args);
      break;
    default:
      console.log(prefix, ...args);
  }
});

// 监听渲染进程的控制台消息
function setupRendererLogging(webContents) {
  webContents.on('console-message', (event, level, message, line, sourceId) => {
    const prefix = '[Renderer Console]';
    const logMessage = `${prefix} [${sourceId}:${line}] ${message}`;
    switch (level) {
      case 0: // VERBOSE
        console.log(logMessage);
        break;
      case 1: // INFO
        console.info(logMessage);
        break;
      case 2: // WARNING
        console.warn(logMessage);
        break;
      case 3: // ERROR
        console.error(logMessage);
        break;
      default:
        console.log(logMessage);
    }
  });
}
