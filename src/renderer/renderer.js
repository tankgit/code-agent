// Marked和Highlight.js将通过CDN加载（在HTML中引入）
// 注意：hljs 和 marked 是全局变量，不需要重新声明

// 等待库加载
function initMarkdown() {
  if (typeof window.marked !== 'undefined') {
    window.marked.setOptions({
      highlight: function(code, lang) {
        if (typeof window.hljs !== 'undefined' && window.hljs.getLanguage(lang)) {
          try {
            return window.hljs.highlight(code, { language: lang }).value;
          } catch (err) {}
        }
        if (typeof window.hljs !== 'undefined') {
          return window.hljs.highlightAuto(code).value;
        }
        return code;
      }
    });
  }
}

// 应用状态
let appState = {
  workDirectory: null,
  currentSessionId: null,
  sessions: [], // 现在包含 {id, title, createdAt, updatedAt}
  settings: null
};

// DOM元素
const workDirSelect = document.getElementById('workDirSelect');
const mainApp = document.getElementById('mainApp');
const selectDirBtn = document.getElementById('selectDirBtn');
const workDirPath = document.getElementById('workDirPath');
const changeDirBtn = document.getElementById('changeDirBtn');
const settingsBtn = document.getElementById('settingsBtn');
const newSessionBtn = document.getElementById('newSessionBtn');
const sessionList = document.getElementById('sessionList');
const chatMessages = document.getElementById('chatMessages');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const statusBar = document.getElementById('statusBar');
const statusBarIcon = statusBar ? statusBar.querySelector('.status-bar-icon') : null;
const statusBarText = statusBar ? statusBar.querySelector('.status-bar-text') : null;

// Context面板元素
const thinkingContent = document.getElementById('thinkingContent');
const todoContent = document.getElementById('todoContent');
const reflectionContent = document.getElementById('reflectionContent');
const codePoolContent = document.getElementById('codePoolContent');
const memoPoolContent = document.getElementById('memoPoolContent');
const operationPoolContent = document.getElementById('operationPoolContent');

// 当前消息状态
let currentMessage = null;
let currentToolCalls = new Map(); // 存储工具调用的DOM元素
let currentToolCallsData = []; // 存储工具调用的数据（用于保存）
let planningTodos = [];
let isExecuting = false; // 是否正在执行任务
let currentTaskAbortController = null; // 当前任务的取消控制器
let isFirstTodo = true; // 是否是第一个TODO
let currentOpenToolCallId = null; // 当前打开的对话框对应的工具调用ID
let operationPoolMap = new Map(); // 存储调用池中操作的DOM元素映射

// 工具名称到展示名称的映射
const toolDisplayNames = {
  'read_file': '读取文件',
  'list_directory': '查看目录',
  'ls': '查看目录',
  'search_text': '搜索文本',
  'search_file': '搜索文件',
};

// 模块类型到卡片元素的映射
const moduleCardMap = {
  'thinking': 'thinking',
  'planning': 'planning',
  'reflection': 'reflection',
  'codePool': 'codePool',
  'memoPool': 'memoPool',
  'operationPool': 'operationPool'
};

// 获取卡片元素
function getCardElement(moduleName) {
  return document.querySelector(`.context-card[data-module="${moduleName}"]`);
}

// 展开卡片
function expandCard(moduleName) {
  const card = getCardElement(moduleName);
  if (card) {
    card.classList.remove('collapsed');
  }
}

// 折叠卡片
function collapseCard(moduleName) {
  const card = getCardElement(moduleName);
  if (card) {
    card.classList.add('collapsed');
  }
}

// 设置卡片运行状态
function setCardRunning(moduleName, isRunning) {
  const card = getCardElement(moduleName);
  if (card) {
    if (isRunning) {
      card.classList.add('running');
      expandCard(moduleName); // 运行时自动展开
    } else {
      card.classList.remove('running');
      // TODO模块卡片保持展开，不自动折叠
      if (moduleName !== 'planning') {
        // 延迟折叠，让用户看到完成状态
        setTimeout(() => {
          collapseCard(moduleName);
        }, 1000);
      } else {
        expandCard(moduleName);
      }
    }
  }
}

// 初始化卡片折叠/展开功能
function initCardToggle() {
  const cards = document.querySelectorAll('.context-card');
  cards.forEach(card => {
    const header = card.querySelector('.context-card-header');
    const moduleName = card.getAttribute('data-module');
    
    // 为所有卡片添加点击事件（包括planning）
    if (header) {
      header.addEventListener('click', () => {
        card.classList.toggle('collapsed');
      });
    }
    
    // TODO模块卡片默认展开，其他默认折叠
    if (moduleName === 'planning') {
      card.classList.remove('collapsed');
    } else {
      card.classList.add('collapsed');
    }
  });
}

// HTML转义函数
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 初始化
async function init() {
  const state = await window.electronAPI.getAppState();
  appState.workDirectory = state.workDirectory;
  appState.settings = state.settings;

  if (appState.workDirectory) {
    showMainApp();
  }

  await loadSessions();
  setupEventListeners();
  initCardToggle();
}

function setupEventListeners() {
  selectDirBtn.addEventListener('click', async () => {
    try {
      console.log('Select directory button clicked');
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        alert('electronAPI 未加载，请刷新页面重试');
        return;
      }
      const dir = await window.electronAPI.selectWorkDirectory();
      console.log('Selected directory:', dir);
      if (dir) {
        appState.workDirectory = dir;
        showMainApp();
        await loadSessions();
      }
    } catch (error) {
      console.error('Error selecting directory:', error);
      alert('选择目录时出错: ' + error.message);
    }
  });

  changeDirBtn.addEventListener('click', async () => {
    try {
      console.log('Change directory button clicked');
      if (!window.electronAPI) {
        console.error('electronAPI is not available');
        alert('electronAPI 未加载，请刷新页面重试');
        return;
      }
      
      // 确认是否要切换工作目录（会清空当前会话）
      const confirmed = confirm('切换工作目录将清空当前会话列表，是否继续？');
      if (!confirmed) {
        return;
      }
      
      const dir = await window.electronAPI.selectWorkDirectory();
      console.log('Selected directory:', dir);
      if (dir) {
        // 清空当前会话状态
        appState.currentSessionId = null;
        appState.sessions = [];
        chatMessages.innerHTML = '';
        
        // 清空Context面板
        clearContextPanel();
        
        // 更新工作目录
        appState.workDirectory = dir;
        workDirPath.textContent = dir;
        
        // 重新加载新工作目录的会话
        await loadSessions();
      }
    } catch (error) {
      console.error('Error changing directory:', error);
      alert('切换目录时出错: ' + error.message);
    }
  });

  settingsBtn.addEventListener('click', () => {
    window.electronAPI.openSettings();
  });

  newSessionBtn.addEventListener('click', createNewSession);

  sendBtn.addEventListener('click', sendMessage);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isExecuting) {
        sendMessage();
      }
    }
  });

  // 监听消息流
  window.electronAPI.onMessageChunk(handleMessageChunk);
}

function showMainApp() {
  workDirSelect.style.display = 'none';
  mainApp.style.display = 'flex';
  workDirPath.textContent = appState.workDirectory || '未选择';
}

async function loadSessions() {
  const sessions = await window.electronAPI.listSessions();
  appState.sessions = sessions;
  renderSessionList();

  if (sessions.length > 0 && !appState.currentSessionId) {
    const firstSessionId = typeof sessions[0] === 'string' ? sessions[0] : sessions[0].id;
    switchSession(firstSessionId);
  } else if (sessions.length === 0) {
    createNewSession();
  }
}

function renderSessionList() {
  sessionList.innerHTML = '';
  appState.sessions.forEach(session => {
    const sessionId = typeof session === 'string' ? session : session.id;
    const sessionTitle = typeof session === 'object' ? session.title : `会话 ${sessionId.substring(0, 8)}`;
    const sessionTime = typeof session === 'object' ? session.updatedAt : (parseInt(sessionId.split('_')[1]) || Date.now());
    
    const item = document.createElement('div');
    item.className = 'session-item';
    if (sessionId === appState.currentSessionId) {
      item.classList.add('active');
    }
    
    item.innerHTML = `
      <div class="session-item-content">
        <div class="session-item-title">${escapeHtml(sessionTitle)}</div>
        <div class="session-item-time">${new Date(sessionTime).toLocaleString()}</div>
      </div>
      <button class="session-item-delete" title="删除会话" onclick="event.stopPropagation(); deleteSession('${sessionId}')">×</button>
    `;
    item.addEventListener('click', () => switchSession(sessionId));
    sessionList.appendChild(item);
  });
}

function createNewSession() {
  const sessionId = `session_${Date.now()}`;
  appState.currentSessionId = sessionId;
  // 检查是否已存在
  const exists = appState.sessions.some(s => (typeof s === 'string' ? s : s.id) === sessionId);
  if (!exists) {
    appState.sessions.unshift({
      id: sessionId,
      title: '新会话',
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  renderSessionList();
  // 清空聊天消息和右侧卡片（新会话应该是空的）
  chatMessages.innerHTML = '';
  clearContextPanel();
  // 加载会话（新会话会返回null，但清空操作已经完成）
  loadSession(sessionId);
}

async function deleteSession(sessionId) {
  // 确认删除
  if (!confirm('确定要删除这个会话吗？此操作无法撤销。')) {
    return;
  }
  
  try {
    const success = await window.electronAPI.deleteSession(sessionId);
    if (success) {
      // 从会话列表中移除
      appState.sessions = appState.sessions.filter(s => (typeof s === 'string' ? s : s.id) !== sessionId);
      
      // 如果删除的是当前会话，切换到其他会话或创建新会话
      if (sessionId === appState.currentSessionId) {
        if (appState.sessions.length > 0) {
          const nextSessionId = typeof appState.sessions[0] === 'string' ? appState.sessions[0] : appState.sessions[0].id;
          await switchSession(nextSessionId);
        } else {
          appState.currentSessionId = null;
          chatMessages.innerHTML = '';
          // 清空Context面板
          clearContextPanel();
        }
      }
      
      renderSessionList();
      updateProgress();
    } else {
      alert('删除会话失败，请重试');
    }
  } catch (error) {
    console.error('Error deleting session:', error);
    alert('删除会话时出错: ' + error.message);
  }
}

// 将deleteSession暴露为全局函数，以便在onclick中使用
window.deleteSession = deleteSession;

async function switchSession(sessionId) {
  appState.currentSessionId = sessionId;
  renderSessionList();
  await loadSession(sessionId);
}

// 移除工具结果JSON块的函数（更激进的清理）
function removeToolResultJsonBlocks(content, toolCalls) {
  if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
    return content;
  }
  
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  let filteredContent = content;
  
  // 收集所有工具结果的完整签名（用于精确匹配）
  const toolResultSignatures = new Set();
  const toolResultContentStrings = new Set();
  
  toolCalls.forEach(toolCall => {
    if (toolCall.result) {
      try {
        // 紧凑格式
        const resultStr = JSON.stringify(toolCall.result);
        toolResultSignatures.add(resultStr);
        
        // 格式化版本（2空格缩进）
        const formattedStr = JSON.stringify(toolCall.result, null, 2);
        toolResultSignatures.add(formattedStr);
        
        // 4空格缩进版本
        const formattedStr4 = JSON.stringify(toolCall.result, null, 4);
        toolResultSignatures.add(formattedStr4);
        
        // 无缩进单行版本（移除所有换行和多余空格）
        const compactStr = resultStr.replace(/\s+/g, ' ').trim();
        toolResultSignatures.add(compactStr);
        
        // 如果结果有content字段，收集content内容用于匹配
        if (toolCall.result.content && typeof toolCall.result.content === 'string') {
          toolResultContentStrings.add(toolCall.result.content);
          // 如果content很长，也收集前100个字符用于部分匹配
          if (toolCall.result.content.length > 100) {
            toolResultContentStrings.add(toolCall.result.content.substring(0, 100));
          }
        }
      } catch (e) {
        // 忽略错误
      }
    }
  });
  
  // 方法1: 移除代码块中的JSON（```json ... ``` 或 ``` ... ```）
  const codeBlockPattern = /```(?:json|javascript|js)?\s*\n?([\s\S]*?)\n?\s*```/gi;
  filteredContent = filteredContent.replace(codeBlockPattern, (match, codeContent) => {
    const trimmedContent = codeContent.trim();
    
    // 直接匹配
    if (toolResultSignatures.has(trimmedContent)) {
      return '';
    }
    
    // 尝试解析为JSON并检查
    try {
      const parsed = JSON.parse(trimmedContent);
      const normalized = JSON.stringify(parsed);
      const normalizedFormatted = JSON.stringify(parsed, null, 2);
      
      if (toolResultSignatures.has(normalized) || toolResultSignatures.has(normalizedFormatted)) {
        return '';
      }
      
      // 检查content字段
      if (parsed.content && typeof parsed.content === 'string' && toolResultContentStrings.has(parsed.content)) {
        return '';
      }
    } catch (e) {
      // 不是JSON，检查是否包含工具结果的内容
      for (const contentStr of toolResultContentStrings) {
        if (contentStr.length > 50 && trimmedContent.includes(contentStr)) {
          return '';
        }
      }
    }
    
    return match;
  });
  
  // 方法2: 移除独立的JSON对象块（需要更智能的匹配，处理嵌套的大括号）
  // 使用更精确的匹配：找到所有可能的JSON对象
  let jsonStartIndex = 0;
  while ((jsonStartIndex = filteredContent.indexOf('{', jsonStartIndex)) !== -1) {
    let braceCount = 0;
    let inString = false;
    let escapeNext = false;
    let jsonEndIndex = -1;
    
    for (let i = jsonStartIndex; i < filteredContent.length; i++) {
      const char = filteredContent[i];
      
      if (escapeNext) {
        escapeNext = false;
        continue;
      }
      
      if (char === '\\') {
        escapeNext = true;
        continue;
      }
      
      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            jsonEndIndex = i;
            break;
          }
        }
      }
    }
    
    if (jsonEndIndex !== -1) {
      const jsonMatch = filteredContent.substring(jsonStartIndex, jsonEndIndex + 1);
      
      try {
        const parsed = JSON.parse(jsonMatch);
        const normalized = JSON.stringify(parsed);
        const normalizedFormatted = JSON.stringify(parsed, null, 2);
        
        // 检查是否匹配任何工具结果
        if (toolResultSignatures.has(normalized) || toolResultSignatures.has(normalizedFormatted)) {
          filteredContent = filteredContent.substring(0, jsonStartIndex) + filteredContent.substring(jsonEndIndex + 1);
          continue; // 继续搜索，不递增索引
        }
        
        // 检查content字段
        if (parsed.content && typeof parsed.content === 'string' && toolResultContentStrings.has(parsed.content)) {
          filteredContent = filteredContent.substring(0, jsonStartIndex) + filteredContent.substring(jsonEndIndex + 1);
          continue;
        }
        
        // 检查对象结构是否与工具结果匹配
        for (const toolCall of toolCalls) {
          if (toolCall.result && typeof toolCall.result === 'object') {
            const resultKeys = Object.keys(toolCall.result).sort();
            const parsedKeys = Object.keys(parsed).sort();
            
            if (resultKeys.length === parsedKeys.length && 
                resultKeys.every((key, idx) => key === parsedKeys[idx])) {
              // 键完全匹配，检查值是否也匹配
              let allValuesMatch = true;
              for (const key of resultKeys) {
                const resultValue = JSON.stringify(toolCall.result[key]);
                const parsedValue = JSON.stringify(parsed[key]);
                if (resultValue !== parsedValue) {
                  allValuesMatch = false;
                  break;
                }
              }
              if (allValuesMatch) {
                filteredContent = filteredContent.substring(0, jsonStartIndex) + filteredContent.substring(jsonEndIndex + 1);
                continue;
              }
            }
          }
        }
      } catch (e) {
        // 不是有效JSON，继续
      }
    }
    
    jsonStartIndex++;
  }
  
  // 方法3: 移除可能直接包含工具结果内容的文本块
  for (const contentStr of toolResultContentStrings) {
    if (contentStr.length > 100) {
      // 如果是长内容，尝试匹配包含它的部分
      const escapedContent = contentStr.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const contentPattern = new RegExp(escapedContent + '[\\s\\S]{0,5000}', 'g');
      filteredContent = filteredContent.replace(contentPattern, '');
    }
  }
  
  // 清理多余的空白行和空行
  filteredContent = filteredContent.replace(/\n{3,}/g, '\n\n');
  filteredContent = filteredContent.replace(/^\s*\n\s*\n/gm, '\n');
  filteredContent = filteredContent.trim();
  
  return filteredContent;
}

// 过滤工具调用结果JSON的函数
function filterToolResultFromContent(content, toolCalls) {
  if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
    return content;
  }
  
  if (!content || typeof content !== 'string') {
    return content;
  }
  
  let filteredContent = content;
  
  // 对每个工具调用，尝试移除其结果的JSON内容
  toolCalls.forEach(toolCall => {
    if (toolCall.result) {
      try {
        // 方法1: 移除完全匹配的 JSON 字符串（紧凑格式）
        const resultStr = JSON.stringify(toolCall.result);
        if (resultStr && resultStr.length > 0) {
          // 直接匹配整个JSON字符串（允许前后空白）
          filteredContent = filteredContent.replace(new RegExp('\\s*' + resultStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'g'), '');
        }
        
        // 方法2: 移除格式化后的 JSON（多行，带缩进）
        const formattedResult = JSON.stringify(toolCall.result, null, 2);
        if (formattedResult && formattedResult.length > 0) {
          // 匹配多行JSON，允许缩进变化
          const lines = formattedResult.split('\n');
          if (lines.length > 1) {
            // 匹配多行JSON块
            const firstLine = lines[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const lastLine = lines[lines.length - 1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // 匹配从第一行到最后一行之间的内容
            const multilinePattern = new RegExp(firstLine + '[\\s\\S]*?' + lastLine, 'g');
            filteredContent = filteredContent.replace(multilinePattern, '');
          } else {
            // 单行，直接匹配
            filteredContent = filteredContent.replace(new RegExp('\\s*' + formattedResult.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'g'), '');
          }
        }
        
        // 方法3: 如果结果包含 content 字段，移除可能被展示的内容
        if (toolCall.result.content && typeof toolCall.result.content === 'string') {
          const resultContent = toolCall.result.content;
          // 如果内容较长，尝试移除它
          if (resultContent.length > 50) {
            // 匹配可能出现的文件内容（通常以某些字符开始）
            const escapedStart = resultContent.substring(0, Math.min(50, resultContent.length)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // 尝试匹配包含该内容的JSON对象
            const contentPattern = new RegExp(`["']content["']\\s*:\\s*["']${escapedStart}[^"']*["']`, 'gi');
            filteredContent = filteredContent.replace(contentPattern, '');
            // 也尝试直接匹配内容（如果它独立出现）
            if (resultContent.length < 500) {
              const directContentPattern = new RegExp(resultContent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
              filteredContent = filteredContent.replace(directContentPattern, '');
            }
          }
        }
        
        // 方法4: 尝试通过结构匹配 - 如果结果的键匹配，尝试移除整个JSON块
        if (typeof toolCall.result === 'object' && toolCall.result !== null) {
          const keys = Object.keys(toolCall.result);
          if (keys.length > 0) {
            // 构建一个匹配该对象结构的模式
            // 例如：如果结果有 "content" 键，尝试匹配包含该键的JSON对象
            const firstKey = keys[0];
            const firstKeyEscaped = firstKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // 匹配包含该键的JSON对象块
            const objectPattern = new RegExp(`\\{[^}]*["']${firstKeyEscaped}["']\\s*:[^}]*\\}`, 'gi');
            // 但只移除如果它看起来像工具结果（通过检查值是否匹配）
            const matches = filteredContent.match(objectPattern);
            if (matches) {
              matches.forEach(match => {
                try {
                  const parsed = JSON.parse(match);
                  // 如果解析出的对象与工具结果匹配，移除它
                  if (JSON.stringify(parsed) === resultStr || JSON.stringify(parsed) === JSON.stringify(toolCall.result)) {
                    filteredContent = filteredContent.replace(match, '');
                  }
                } catch (e) {
                  // 不是有效JSON，跳过
                }
              });
            }
          }
        }
      } catch (e) {
        // 忽略解析错误
        console.warn('[Renderer] Failed to filter tool result from content:', e);
      }
    }
  });
  
  // 清理多余的空白行和空行
  filteredContent = filteredContent.replace(/\n{3,}/g, '\n\n');
  // 移除可能残留的 JSON 标记（单独的 {} 或 []）
  filteredContent = filteredContent.replace(/^[\s\n]*[{\[][\s\n]*[}\]][\s\n]*$/gm, '');
  // 清理多余的空白
  filteredContent = filteredContent.trim();
  
  return filteredContent;
}

async function loadSession(sessionId) {
  const sessionData = await window.electronAPI.loadSession(sessionId);
  chatMessages.innerHTML = '';

  // 先清空右侧卡片（无论是新会话还是已有会话，都会先清空）
  clearContextPanel();

  if (sessionData && sessionData.history) {
    // 处理新的历史格式（MessageHistory格式）
    if (sessionData.history.history) {
      sessionData.history.history.forEach(msg => {
        // 跳过空消息（没有内容且没有工具调用）
        const content = msg.content || '';
        const toolCalls = msg.toolCalls || null;
        if (!content.trim() && (!toolCalls || toolCalls.length === 0)) {
          return; // 跳过空消息
        }
        
        // 还原占位符（简单处理，实际应该更复杂）
        let processedContent = content.replace(/\[CODE_(\d+)\]/g, '[代码片段]');
        processedContent = processedContent.replace(/\[TOOL_(\d+)\]/g, '[工具调用结果]');
        
        // 如果是assistant消息且有工具调用，过滤掉工具调用结果的JSON内容
        if (msg.role === 'assistant' && toolCalls && toolCalls.length > 0) {
          processedContent = filterToolResultFromContent(processedContent, toolCalls);
          // 额外清理：移除任何看起来像工具结果JSON的块（更激进的清理）
          processedContent = removeToolResultJsonBlocks(processedContent, toolCalls);
        }
        
        // 如果有工具调用信息，传递它
        addMessage(msg.role, processedContent, toolCalls);
      });
    } else if (Array.isArray(sessionData.history)) {
      // 兼容旧格式
      sessionData.history.forEach(msg => {
        const content = msg.content || '';
        const toolCalls = msg.toolCalls || null;
        if (!content.trim() && (!toolCalls || toolCalls.length === 0)) {
          return; // 跳过空消息
        }
        
        // 如果是assistant消息且有工具调用，过滤掉工具调用结果的JSON内容
        let processedContent = content;
        if (msg.role === 'assistant' && toolCalls && toolCalls.length > 0) {
          processedContent = filterToolResultFromContent(processedContent, toolCalls);
          // 额外清理：移除任何看起来像工具结果JSON的块（更激进的清理）
          processedContent = removeToolResultJsonBlocks(processedContent, toolCalls);
        }
        
        addMessage(msg.role, processedContent, toolCalls);
      });
    }
  }

  // 更新Context面板（如果有context数据则恢复，否则保持清空状态）
  if (sessionData && sessionData.context) {
    updateContextPanel(sessionData.context);
  }

  updateProgress();
}

function addMessage(role, content, toolCalls = null) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  
  const contentDiv = document.createElement('div');
  contentDiv.className = 'message-content';
  
  const text = document.createElement('div');
  text.className = 'message-text';
  
  if (role === 'assistant') {
    // 使用与流式显示相同的结构，确保样式一致
    const messageContainer = document.createElement('div');
    messageContainer.className = 'message-container';
    
    // 对于已保存的消息，我们按照工具调用在前、内容在后的顺序显示
    // （因为保存时可能没有保存顺序信息）
    // 但工具调用和内容都直接添加到 message-container 中，不再使用单独的容器
    
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      toolCalls.forEach(toolCall => {
        const toolCallDiv = document.createElement('div');
        toolCallDiv.className = 'tool-call';
        toolCallDiv.id = `tool_${toolCall.id}`;
        
        // 获取工具的展示名称
        const displayName = toolDisplayNames[toolCall.name] || toolCall.name;
        
        // 检测是否失败
        const isFailed = isToolCallFailed(toolCall.result);
        let statusClass = 'pending';
        if (toolCall.result) {
          statusClass = isFailed ? 'failed' : 'completed';
        }
        
        toolCallDiv.innerHTML = `
          <div class="tool-call-bar">
            <span class="tool-call-status ${statusClass}"></span>
            <span class="tool-call-display-name">${escapeHtml(displayName)}</span>
            <span class="tool-call-icon">🔍</span>
          </div>
        `;
        
        // 处理 arguments - 如果是字符串需要解析
        let args = toolCall.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch (e) {
            console.warn('[Renderer] Failed to parse toolCall.arguments:', e, args);
            args = toolCall.arguments; // 保持原样
          }
        }
        
        // 保存工具调用数据到 currentToolCallsData
        const toolCallData = {
          id: toolCall.id,
          name: toolCall.name,
          displayName: displayName,
          arguments: args,
          result: toolCall.result
        };
        currentToolCallsData.push(toolCallData);
        
        // 添加点击事件 - 打开对话框
        const bar = toolCallDiv.querySelector('.tool-call-bar');
        bar.addEventListener('click', () => {
          showToolCallModal(toolCall.id);
        });
        
        // 直接添加到容器中（按顺序）
        messageContainer.appendChild(toolCallDiv);
      });
    }
    
    // 如果有内容，添加内容片段（使用与流式显示相同的类名）
    if (content && content.trim()) {
      const contentFragment = document.createElement('div');
      contentFragment.className = 'message-content-text';
      
      if (typeof window.marked !== 'undefined' && window.marked.parse) {
        contentFragment.innerHTML = window.marked.parse(content);
      } else {
        contentFragment.textContent = content;
      }
      
      // 直接添加到容器中（在工具调用之后）
      messageContainer.appendChild(contentFragment);
    }
    
    text.appendChild(messageContainer);
  } else {
    text.textContent = content;
  }
  
  contentDiv.appendChild(text);
  messageDiv.appendChild(contentDiv);
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  
  return messageDiv;
}

// 状态栏自动隐藏定时器
let statusBarHideTimer = null;

// 更新状态栏
function updateStatusBar(status, text) {
  if (!statusBar || !statusBarIcon || !statusBarText) return;
  
  // 清除之前的隐藏定时器
  if (statusBarHideTimer) {
    clearTimeout(statusBarHideTimer);
    statusBarHideTimer = null;
  }
  
  // 显示状态栏
  statusBar.style.display = 'block';
  
  // 根据状态设置图标和文本
  let icon = '';
  switch (status) {
    case 'thinking':
      icon = '🤔';
      break;
    case 'planning':
      icon = '📋';
      break;
    case 'executing':
      icon = '⚙️';
      break;
    case 'executing_in_progress':
      icon = '⚙️';
      break;
    case 'executed':
      icon = '✓';
      break;
    case 'reflecting':
      icon = '💭';
      break;
    case 'completed':
      icon = '✅';
      break;
    default:
      icon = '⏳';
  }
  
  statusBarIcon.textContent = icon;
  statusBarText.textContent = text;
  
  // 如果是完成状态，3秒后自动隐藏
  if (status === 'completed') {
    statusBarHideTimer = setTimeout(() => {
      statusBar.style.display = 'none';
      statusBarHideTimer = null;
    }, 3000);
  }
}

// 设置执行状态UI
function setExecutingState(executing) {
  isExecuting = executing;
  if (isExecuting) {
    // 禁用输入框并设置占位符文本
    chatInput.disabled = true;
    chatInput.value = '正在执行...';
    chatInput.style.color = '#a0a0a0';
    chatInput.style.cursor = 'not-allowed';
    
    // 将发送按钮改为停止按钮
    sendBtn.textContent = '停止';
    sendBtn.disabled = false;
    sendBtn.classList.add('stop-btn');
    sendBtn.onclick = stopMessage;
  } else {
    // 恢复输入框
    chatInput.disabled = false;
    chatInput.value = '';
    chatInput.style.color = '';
    chatInput.style.cursor = '';
    chatInput.placeholder = '输入您的消息...';
    
    // 恢复发送按钮
    sendBtn.textContent = '发送';
    sendBtn.disabled = false;
    sendBtn.classList.remove('stop-btn');
    sendBtn.onclick = sendMessage;
  }
}

// 停止当前任务
async function stopMessage() {
  console.log('[Renderer] stopMessage called');
  if (!isExecuting) {
    return;
  }
  
  try {
    // 调用主进程停止任务
    await window.electronAPI.stopMessage(appState.currentSessionId);
    
    // 立即更新UI状态
    setExecutingState(false);
    
    // 如果当前有消息，显示已停止
    if (currentMessage && currentMessage.activeContentFragment) {
      currentMessage.activeContentFragment.innerHTML += '<div style="color: #ffa500; margin-top: 8px;">任务已停止</div>';
    }
  } catch (error) {
    console.error('[Renderer] Error stopping message:', error);
  }
}

async function sendMessage() {
  const message = chatInput.value.trim();
  console.log('[Renderer] sendMessage called', { message, sessionId: appState.currentSessionId });
  
  if (!message || !appState.currentSessionId) {
    console.warn('[Renderer] sendMessage aborted: missing message or sessionId', { message: !!message, sessionId: !!appState.currentSessionId });
    return;
  }

  if (isExecuting) {
    console.warn('[Renderer] sendMessage aborted: already executing');
    return;
  }

  // 保存用户输入的消息
  const userMessage = message;
  
  // 设置执行状态
  setExecutingState(true);
  
  // 显示状态栏
  updateStatusBar('thinking', '开始处理...');
  
  // 添加用户消息
  console.log('[Renderer] Adding user message to UI');
  addMessage('user', userMessage);

  // 创建AI消息容器
  const aiMessageDiv = addMessage('assistant', '');
  const aiTextDiv = aiMessageDiv.querySelector('.message-text');
  aiTextDiv.innerHTML = '';
  
  // 创建统一的内容容器，按时间顺序添加内容片段和工具调用
  const messageContainer = document.createElement('div');
  messageContainer.className = 'message-container';
  aiTextDiv.appendChild(messageContainer);
  
  currentMessage = { 
    container: messageContainer,  // 统一容器
    content: '',  // 累积的内容（用于过滤）
    activeContentFragment: null,  // 当前活跃的内容片段（可能为null，用于流式追加）
    contentFragments: []  // 所有内容片段列表（用于过滤）
  };
  currentToolCallsData = []; // 重置工具调用数据
  currentToolCalls.clear(); // 清空工具调用Map
  isFirstTodo = true; // 重置第一个TODO标志
  console.log('[Renderer] Created AI message container', { hasContainer: !!messageContainer });

  try {
    console.log('[Renderer] Calling electronAPI.sendMessage', { message: userMessage, sessionId: appState.currentSessionId });
    await window.electronAPI.sendMessage(userMessage, appState.currentSessionId);
    console.log('[Renderer] electronAPI.sendMessage completed');
  } catch (error) {
    console.error('[Renderer] Error in sendMessage:', error);
    if (currentMessage) {
      // 如果没有活跃的内容片段，创建一个用于显示错误
      if (!currentMessage.activeContentFragment) {
        const errorFragment = document.createElement('div');
        errorFragment.className = 'message-content-text';
        currentMessage.container.appendChild(errorFragment);
        currentMessage.activeContentFragment = errorFragment;
        currentMessage.contentFragments.push(errorFragment);
      }
      currentMessage.activeContentFragment.innerHTML += `<span style="color: #ff6b6b;">错误: ${error.message}</span>`;
    }
  } finally {
    // 恢复执行状态
    setExecutingState(false);
    updateProgress();
    console.log('[Renderer] sendMessage finished, currentMessage content length:', currentMessage ? currentMessage.content.length : 0);
    // 刷新会话列表以更新标题（但保持当前会话选中）
    const currentSessionId = appState.currentSessionId;
    await loadSessions();
    // 恢复当前会话选中状态
    if (currentSessionId) {
      appState.currentSessionId = currentSessionId;
      renderSessionList();
    }
  }
}

function handleMessageChunk(chunk) {
  console.log('[Renderer] handleMessageChunk received:', { 
    type: chunk.type, 
    status: chunk.status,
    hasContent: !!chunk.content,
    contentLength: chunk.content ? chunk.content.length : 0,
    chunk: JSON.stringify(chunk).substring(0, 200)
  });
  
  // 检查是否收到停止信号
  if (chunk.type === 'stopped') {
    setExecutingState(false);
    if (statusBar) {
      statusBar.style.display = 'none';
    }
    if (statusBarHideTimer) {
      clearTimeout(statusBarHideTimer);
      statusBarHideTimer = null;
    }
    if (currentMessage) {
      // 如果没有活跃的内容片段，创建一个用于显示停止消息
      if (!currentMessage.activeContentFragment) {
        const stopFragment = document.createElement('div');
        stopFragment.className = 'message-content-text';
        currentMessage.container.appendChild(stopFragment);
        currentMessage.activeContentFragment = stopFragment;
        currentMessage.contentFragments.push(stopFragment);
      }
      currentMessage.activeContentFragment.innerHTML += '<div style="color: #ffa500; margin-top: 8px;">任务已停止</div>';
    }
    return;
  }
  
  // 检查是否收到完成信号
  if (chunk.type === 'complete') {
    setExecutingState(false);
    updateStatusBar('completed', '回答已结束');
  }
  
  switch (chunk.type) {
    case 'thinking':
      console.log('[Renderer] Processing thinking chunk', { status: chunk.status, hasContent: !!chunk.content });
      // 处理运行状态
      if (chunk.status === 'start') {
        setCardRunning('thinking', true);
        updateStatusBar('thinking', 'AI思考中...');
        // 开始时清空并展开，准备流式写入
        thinkingContent.textContent = '';
        thinkingContent.classList.remove('empty');
        expandCard('thinking');
      } else if (chunk.status === 'update' || chunk.status === 'delta') {
        // 流式增量更新（如果后端支持）
        if (chunk.content) {
          thinkingContent.textContent += chunk.content;
          // 始终滚动到底部
          thinkingContent.scrollTop = thinkingContent.scrollHeight;
        }
      } else if (chunk.status === 'complete') {
        // 若有最终内容，补齐一次；若已流式更新，这里作为兜底
        if (chunk.content) {
          thinkingContent.textContent += chunk.content;
        }
        thinkingContent.classList.remove('empty');
        setCardRunning('thinking', false);
        console.log('[Renderer] Thinking content set, length:', chunk.content ? chunk.content.length : 0);
        // 结束时确保滚动到底部
        thinkingContent.scrollTop = thinkingContent.scrollHeight;
      }
      break;

case 'planning':
      console.log('[Renderer] Processing planning chunk', { status: chunk.status, hasTodos: !!chunk.todos, todosCount: chunk.todos ? chunk.todos.length : 0 });
      // 处理运行状态
      if (chunk.status === 'start') {
        setCardRunning('planning', true);
        updateStatusBar('planning', '规划TODO任务中...');
      } else if (chunk.status === 'complete') {
        if (chunk.todos) {
          renderTodos(chunk.todos);
        }
        setCardRunning('planning', false);
      }
      break;
case 'todo_start':
  if (chunk.todo && chunk.todo.title) {
    updateTodoStatusByTitle(chunk.todo.title, 'running');
    updateStatusBar('executing', `开始执行任务: ${chunk.todo.title}`);
    isFirstTodo = false;
  }
  break;
case 'todo_complete':
  if (chunk.todo && chunk.todo.title) {
    updateTodoStatusByTitle(chunk.todo.title, 'completed');
    updateStatusBar('executed', `任务已执行结束: ${chunk.todo.title}`);
  }
  break;

    case 'reflection':
      console.log('[Renderer] Processing reflection chunk', { status: chunk.status, hasReflection: !!chunk.reflection });
      // 处理运行状态
      if (chunk.status === 'start') {
        setCardRunning('reflection', true);
        updateStatusBar('reflecting', '正在反思...');
      } else if (chunk.status === 'complete') {
        if (chunk.reflection) {
          addReflection(chunk.reflection);
        }
        setCardRunning('reflection', false);
        if (chunk.reflection && chunk.reflection.type === 'SUCCESS') {
          const running = planningTodos.find(t => t.status === 'running');
          if (running) updateTodoStatusByTitle(running.title, 'completed');
        }
      }
      break;

    case 'context_selection':
      // Context选择阶段可能不需要显示在卡片中，但如果有需要可以添加
      break;

    case 'content':
      console.log('[Renderer] Processing content chunk', { 
        contentLength: chunk.content ? chunk.content.length : 0,
        hasCurrentMessage: !!currentMessage,
        currentContentLength: currentMessage ? currentMessage.content.length : 0
      });
      // 如果有内容输出，更新状态为"正在执行"
      if (currentMessage && currentMessage.content.length === 0 && chunk.content) {
        updateStatusBar('executing_in_progress', '正在执行...');
      }
      if (currentMessage) {
        currentMessage.content += chunk.content;
        console.log('[Renderer] Updated content, new length:', currentMessage.content.length);
        
        const container = currentMessage.container;
        
        // 如果当前活跃的内容片段存在且是容器的最后一个子元素，可以继续追加内容
        // 否则，需要创建新的内容片段
        let contentFragment = currentMessage.activeContentFragment;
        const isLastChild = contentFragment && 
                           contentFragment.parentNode === container && 
                           !contentFragment.nextSibling;
        
        if (!isLastChild) {
          // 创建新的内容片段并追加到容器末尾（按时间顺序）
          contentFragment = document.createElement('div');
          contentFragment.className = 'message-content-text';
          container.appendChild(contentFragment);
          currentMessage.activeContentFragment = contentFragment;
          currentMessage.contentFragments.push(contentFragment);
        }
        
        // 过滤工具结果内容：移除看起来像是工具结果 JSON 的内容
        // 注意：这里只过滤当前内容片段对应的内容，而不是全部内容
        // 为了简化，我们仍然过滤全部内容，但只更新当前片段
        let filteredContent = filterToolResultFromContent(currentMessage.content, currentToolCallsData);
        
        // 更新内容片段内容
        if (typeof window.marked !== 'undefined' && window.marked.parse) {
          contentFragment.innerHTML = window.marked.parse(filteredContent);
        } else {
          contentFragment.textContent = filteredContent;
        }
        
        chatMessages.scrollTop = chatMessages.scrollHeight;
      } else {
        console.warn('[Renderer] Content chunk received but currentMessage is null!');
      }
      break;

    case 'tool_call_start':
      console.log('[Renderer] Processing tool_call_start', { toolCall: chunk.toolCall });
      // 如果有工具调用，更新状态为"正在执行"
      updateStatusBar('executing_in_progress', '正在执行...');
      addToolCall(chunk.toolCall);
      // 立即添加到调用池
      addOperationToPool(chunk.toolCall);
      break;

    case 'tool_call_result':
      console.log('[Renderer] Processing tool_call_result', { toolCallId: chunk.toolCallId, hasResult: !!chunk.result });
      updateToolCallResult(chunk.toolCallId, chunk.result);
      // 更新调用池中的操作状态
      updateOperationInPool(chunk.toolCallId, chunk.result);
      break;

    case 'tool_call_error':
      console.error('[Renderer] Processing tool_call_error', { toolCallId: chunk.toolCallId, error: chunk.error });
      // 将错误信息作为结果返回
      updateToolCallResult(chunk.toolCallId, { error: chunk.error });
      break;

    case 'memo_added':
      console.log('[Renderer] Processing memo_added', { memo: chunk.memo });
      // memo_added时展开备忘池卡片
      expandCard('memoPool');
      addMemo(chunk.memo);
      break;

    case 'error':
      console.error('[Renderer] Processing error chunk', { error: chunk.error });
      if (currentMessage) {
        // 如果没有活跃的内容片段，创建一个用于显示错误
        if (!currentMessage.activeContentFragment) {
          const errorFragment = document.createElement('div');
          errorFragment.className = 'message-content-text';
          currentMessage.container.appendChild(errorFragment);
          currentMessage.activeContentFragment = errorFragment;
          currentMessage.contentFragments.push(errorFragment);
        }
        currentMessage.activeContentFragment.innerHTML += `<div style="color: #ff6b6b;">错误: ${chunk.error}</div>`;
      }
      break;

    default:
      console.log('[Renderer] Unknown chunk type:', chunk.type);
  }

  updateProgress();
}

function addToolCall(toolCall) {
  if (!currentMessage) return;

  const toolCallDiv = document.createElement('div');
  toolCallDiv.className = 'tool-call';
  toolCallDiv.id = `tool_${toolCall.id}`;
  
  // 获取工具的展示名称
  const displayName = toolDisplayNames[toolCall.name] || toolCall.name;
  
  toolCallDiv.innerHTML = `
    <div class="tool-call-bar">
      <span class="tool-call-status pending"></span>
      <span class="tool-call-display-name">${escapeHtml(displayName)}</span>
      <span class="tool-call-icon">🔍</span>
    </div>
  `;

  // 添加点击事件 - 打开对话框
  const bar = toolCallDiv.querySelector('.tool-call-bar');
  bar.addEventListener('click', () => {
    showToolCallModal(toolCall.id);
  });

  // 将工具调用追加到容器末尾，保持时间顺序
  const container = currentMessage.container;
  
  // 如果当前有活跃的内容片段，关闭它（标记为不再活跃）
  // 这样下次收到内容时，会创建新的内容片段
  if (currentMessage.activeContentFragment) {
    currentMessage.activeContentFragment = null;
  }
  
  // 直接追加到容器末尾（按时间顺序）
  container.appendChild(toolCallDiv);
  
  currentToolCalls.set(toolCall.id, toolCallDiv);
  
  // 处理 arguments - 确保是对象格式
  let args = toolCall.arguments;
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch (e) {
      console.warn('[Renderer] Failed to parse toolCall.arguments in addToolCall:', e, args);
      // 保持原样
    }
  }
  
  // 保存工具调用数据
  currentToolCallsData.push({
    id: toolCall.id,
    name: toolCall.name,
    displayName: displayName,
    arguments: args,
    result: null
  });
  
  console.log('[Renderer] Added tool call:', { 
    id: toolCall.id, 
    name: toolCall.name, 
    arguments: args,
    argumentsType: typeof args 
  });
  
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示工具调用详情对话框
function showToolCallModal(toolCallId) {
  const modal = document.getElementById('toolCallModal');
  const modalTitle = document.getElementById('toolCallModalTitle');
  const modalArgs = document.getElementById('toolCallModalArgs');
  const modalResult = document.getElementById('toolCallModalResult');
  const modalClose = document.getElementById('toolCallModalClose');
  
  // 查找工具调用数据
  const toolCallData = currentToolCallsData.find(tc => tc.id === toolCallId);
  if (!toolCallData) {
    console.error('[Renderer] Tool call data not found:', toolCallId, 'Available IDs:', currentToolCallsData.map(tc => tc.id));
    alert('无法找到工具调用数据，请刷新页面重试');
    return;
  }
  
  console.log('[Renderer] Showing tool call modal:', { toolCallId, toolCallData });
  
  // 设置标题
  modalTitle.textContent = toolCallData.displayName || toolCallData.name;
  
  // 更新参数卡片
  modalArgs.innerHTML = '';
  
  // 处理 arguments - 可能是字符串或对象
  let args = toolCallData.arguments;
  if (!args) {
    modalArgs.innerHTML = '<div style="color: #808080; padding: 8px;">无参数</div>';
  } else {
    // 如果是字符串，尝试解析
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch (e) {
        console.error('[Renderer] Failed to parse arguments:', e);
        modalArgs.innerHTML = `<div style="color: #ff6b6b; padding: 8px;">参数解析失败: ${args}</div>`;
        args = null;
      }
    }
    
    if (args && typeof args === 'object') {
      for (const [key, value] of Object.entries(args)) {
        const item = document.createElement('div');
        item.className = 'tool-call-card-item';
        const keySpan = document.createElement('span');
        keySpan.className = 'tool-call-card-key';
        keySpan.textContent = key + ':';
        const valueSpan = document.createElement('span');
        valueSpan.className = 'tool-call-card-value';
        valueSpan.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        item.appendChild(keySpan);
        item.appendChild(valueSpan);
        modalArgs.appendChild(item);
      }
    } else if (args) {
      // 如果不是对象，直接显示
      const item = document.createElement('div');
      item.className = 'tool-call-card-item';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'tool-call-card-value';
      valueSpan.textContent = String(args);
      item.appendChild(valueSpan);
      modalArgs.appendChild(item);
    }
  }
  
  // 更新结果卡片
  modalResult.innerHTML = '';
  if (toolCallData.result) {
    for (const [key, value] of Object.entries(toolCallData.result)) {
      const item = document.createElement('div');
      item.className = 'tool-call-card-item';
      const keySpan = document.createElement('span');
      keySpan.className = 'tool-call-card-key';
      keySpan.textContent = key + ':';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'tool-call-card-value';
      if (typeof value === 'object') {
        valueSpan.textContent = JSON.stringify(value, null, 2);
      } else {
        valueSpan.textContent = String(value);
      }
      item.appendChild(keySpan);
      item.appendChild(valueSpan);
      modalResult.appendChild(item);
    }
  } else {
    modalResult.innerHTML = '<div style="color: #808080; padding: 8px;">执行中...</div>';
  }
  
  // 显示对话框
  modal.style.display = 'flex';
  currentOpenToolCallId = toolCallId;
  
  // 关闭按钮事件
  const closeModal = () => {
    modal.style.display = 'none';
    currentOpenToolCallId = null;
  };
  
  modalClose.onclick = closeModal;
  modal.querySelector('.tool-call-modal-overlay').onclick = closeModal;
  
  // ESC键关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}


// 检测工具调用是否失败
function isToolCallFailed(result) {
  if (!result) return false;
  // 检查是否有 error 字段
  if (result.error) return true;
  // 检查 success 字段是否为 false
  if (result.success === false) return true;
  return false;
}

function updateToolCallResult(toolCallId, result) {
  const toolCallDiv = currentToolCalls.get(toolCallId);
  if (!toolCallDiv) return;

  const statusDiv = toolCallDiv.querySelector('.tool-call-status');
  statusDiv.classList.remove('pending', 'completed', 'failed');
  
  // 检测是否失败
  const isFailed = isToolCallFailed(result);
  if (isFailed) {
    statusDiv.classList.add('failed');
  } else {
    statusDiv.classList.add('completed');
  }

  // 更新工具调用数据
  const toolCallData = currentToolCallsData.find(tc => tc.id === toolCallId);
  if (toolCallData) {
    toolCallData.result = result;
  }
  
  // 如果对话框正在显示这个工具调用，更新对话框内容
  if (currentOpenToolCallId === toolCallId) {
    const modal = document.getElementById('toolCallModal');
    const modalResult = document.getElementById('toolCallModalResult');
    if (modal && modal.style.display === 'flex' && modalResult) {
      modalResult.innerHTML = '';
      if (result) {
        for (const [key, value] of Object.entries(result)) {
          const item = document.createElement('div');
          item.className = 'tool-call-card-item';
          const keySpan = document.createElement('span');
          keySpan.className = 'tool-call-card-key';
          keySpan.textContent = key + ':';
          const valueSpan = document.createElement('span');
          valueSpan.className = 'tool-call-card-value';
          if (typeof value === 'object') {
            valueSpan.textContent = JSON.stringify(value, null, 2);
          } else {
            valueSpan.textContent = String(value);
          }
          item.appendChild(keySpan);
          item.appendChild(valueSpan);
          modalResult.appendChild(item);
        }
      } else {
        modalResult.innerHTML = '<div style="color: #808080; padding: 8px;">执行中...</div>';
      }
    }
  }
}

function renderTodos(todos) {
  // 保留status字段（如果存在），否则默认为'pending'
  planningTodos = (todos || []).map((t, idx) => ({
    index: idx,
    title: t.title,
    description: t.description || '',
    status: t.status || 'pending' // 保留保存的status，如果没有则默认为pending
  }));

  todoContent.innerHTML = '';
  planningTodos.forEach(todo => {
    const item = document.createElement('div');
    item.className = 'todo-item collapsed';
    item.dataset.index = String(todo.index);

    const header = document.createElement('div');
    header.className = 'todo-header';

    const statusIcon = document.createElement('span');
    statusIcon.className = `todo-status ${todo.status}`; // 使用保存的status

    const titleEl = document.createElement('span');
    titleEl.className = 'todo-title';
    titleEl.textContent = todo.title;

    const toggleEl = document.createElement('span');
    toggleEl.className = 'todo-toggle';
    toggleEl.textContent = '▼';

    header.appendChild(statusIcon);
    header.appendChild(titleEl);
    header.appendChild(toggleEl);

    const details = document.createElement('div');
    details.className = 'todo-details';
    details.textContent = todo.description;

    header.addEventListener('click', () => {
      item.classList.toggle('collapsed');
    });

    // 根据状态设置初始展开/折叠状态
    if (todo.status === 'running') {
      item.classList.remove('collapsed');
    } else if (todo.status === 'completed') {
      item.classList.add('collapsed');
    }

    item.appendChild(header);
    item.appendChild(details);
    todoContent.appendChild(item);
  });
  todoContent.classList.remove('empty');
}

function updateTodoStatusByTitle(title, status) {
  const idx = planningTodos.findIndex(t => t.title === title);
  if (idx >= 0) {
    planningTodos[idx].status = status;
    const item = todoContent.querySelector(`.todo-item[data-index="${idx}"]`);
    if (item) {
      const statusIcon = item.querySelector('.todo-status');
      statusIcon.classList.remove('pending', 'running', 'completed');
      statusIcon.classList.add(status);
      if (status === 'running') {
        item.classList.remove('collapsed');
      } else if (status === 'completed') {
        setTimeout(() => item.classList.add('collapsed'), 1000);
      }
    }
  }
}

function addReflection(reflection) {
  // 从reflection中获取todo任务名，如果没有则使用默认值
  const todoTitle = reflection.todoTitle || '未知任务';
  const statusText = reflection.type || 'SUCCESS';
  
  const reflectionDiv = document.createElement('div');
  reflectionDiv.className = 'reflection-item collapsed';
  reflectionDiv.style.marginBottom = '8px';
  
  reflectionDiv.innerHTML = `
    <div class="reflection-header">
      <span class="reflection-status">[${statusText}]</span>
      <span class="reflection-todo-title">${escapeHtml(todoTitle)}</span>
      <span class="reflection-toggle">▼</span>
    </div>
    <div class="reflection-details" style="display: none;">
      <div class="reflection-reason">${escapeHtml(reflection.reason || '无详细说明')}</div>
    </div>
  `;
  
  // 添加点击事件
  const header = reflectionDiv.querySelector('.reflection-header');
  header.addEventListener('click', () => {
    reflectionDiv.classList.toggle('collapsed');
    const details = reflectionDiv.querySelector('.reflection-details');
    if (reflectionDiv.classList.contains('collapsed')) {
      details.style.display = 'none';
    } else {
      details.style.display = 'block';
    }
  });
  
  reflectionContent.appendChild(reflectionDiv);
  reflectionContent.classList.remove('empty');
  // 始终滚动到底部
  reflectionContent.scrollTop = reflectionContent.scrollHeight;
}

function addMemo(memo) {
  const memoDiv = document.createElement('div');
  memoDiv.className = 'memo-item collapsed';
  memoDiv.style.marginBottom = '8px';
  
  const header = document.createElement('div');
  header.className = 'memo-header';
  
  const titleSpan = document.createElement('strong');
  titleSpan.textContent = memo.title || '无标题';
  
  const toggleSpan = document.createElement('span');
  toggleSpan.className = 'memo-toggle';
  toggleSpan.textContent = '▼';
  
  header.appendChild(titleSpan);
  header.appendChild(toggleSpan);
  
  const details = document.createElement('div');
  details.className = 'memo-details';
  details.textContent = memo.content || '无内容';
  
  header.addEventListener('click', () => {
    memoDiv.classList.toggle('collapsed');
  });
  
  memoDiv.appendChild(header);
  memoDiv.appendChild(details);
  memoPoolContent.appendChild(memoDiv);
  memoPoolContent.classList.remove('empty');
}

// 添加操作到调用池
function addOperationToPool(toolCall, shouldExpand = true) {
  // 检查必要参数
  if (!toolCall || !toolCall.id || !toolCall.name) {
    console.error('[Renderer] Invalid toolCall in addOperationToPool:', toolCall);
    return;
  }
  
  // 获取工具的展示名称
  const displayName = toolDisplayNames[toolCall.name] || toolCall.name;
  
  // 获取toolcall id的末尾6位
  const shortId = String(toolCall.id).length > 6 ? String(toolCall.id).slice(-6) : String(toolCall.id);
  
  const operationDiv = document.createElement('div');
  operationDiv.className = 'operation-item';
  operationDiv.id = `operation_${toolCall.id}`;
  operationDiv.dataset.toolCallId = toolCall.id;
  
  const statusSpan = document.createElement('span');
  statusSpan.className = 'operation-status pending';
  
  const textSpan = document.createElement('span');
  textSpan.className = 'operation-item-text';
  textSpan.textContent = `[${displayName}] ${shortId}`;
  
  operationDiv.appendChild(statusSpan);
  operationDiv.appendChild(textSpan);
  
  // 添加点击事件 - 打开对话框
  operationDiv.addEventListener('click', () => {
    showOperationModal(toolCall.id, toolCall.name, toolCall.arguments);
  });
  
  operationPoolContent.appendChild(operationDiv);
  operationPoolContent.classList.remove('empty');
  
  // 保存到Map中
  operationPoolMap.set(toolCall.id, {
    element: operationDiv,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    displayName: displayName,
    arguments: toolCall.arguments,
    result: null
  });
  
  // 只有在实时添加时才展开调用池卡片（恢复会话时不展开）
  if (shouldExpand) {
    expandCard('operationPool');
  }
}

// 更新调用池中的操作状态
function updateOperationInPool(toolCallId, result) {
  const operationData = operationPoolMap.get(toolCallId);
  if (!operationData) {
    console.warn('[Renderer] Operation not found in pool:', toolCallId);
    return;
  }
  
  const operationDiv = operationData.element;
  const statusSpan = operationDiv.querySelector('.operation-status');
  
  // 更新状态
  statusSpan.classList.remove('pending', 'completed', 'failed');
  
  // 检测是否失败
  const isFailed = isToolCallFailed(result);
  if (isFailed) {
    statusSpan.classList.add('failed');
  } else {
    statusSpan.classList.add('completed');
  }
  
  // 更新数据
  operationData.result = result;
  
  // 如果对话框正在显示这个操作，更新对话框内容
  if (currentOpenToolCallId === toolCallId) {
    const modal = document.getElementById('operationModal');
    const modalResult = document.getElementById('operationModalResult');
    if (modal && modal.style.display === 'flex' && modalResult) {
      updateOperationModalResult(modalResult, result);
    }
  }
}

// 显示操作详情对话框
function showOperationModal(toolCallId, toolName, args) {
  const modal = document.getElementById('operationModal');
  const modalTitle = document.getElementById('operationModalTitle');
  const modalId = document.getElementById('operationModalId');
  const modalArgs = document.getElementById('operationModalArgs');
  const modalResult = document.getElementById('operationModalResult');
  const modalClose = document.getElementById('operationModalClose');
  
  // 查找操作数据
  const operationData = operationPoolMap.get(toolCallId);
  if (!operationData) {
    console.error('[Renderer] Operation data not found:', toolCallId);
    alert('无法找到操作数据，请刷新页面重试');
    return;
  }
  
  console.log('[Renderer] Showing operation modal:', { toolCallId, operationData });
  
  // 设置标题
  modalTitle.textContent = operationData.displayName || operationData.toolName;
  
  // 设置完整ID
  modalId.textContent = toolCallId;
  
  // 更新参数卡片
  modalArgs.innerHTML = '';
  
  // 处理 arguments - 可能是字符串或对象
  let argumentsData = args || operationData.arguments;
  if (!argumentsData) {
    modalArgs.innerHTML = '<div style="color: #808080; padding: 8px;">无参数</div>';
  } else {
    // 如果是字符串，尝试解析
    if (typeof argumentsData === 'string') {
      try {
        argumentsData = JSON.parse(argumentsData);
      } catch (e) {
        console.error('[Renderer] Failed to parse arguments:', e);
        modalArgs.innerHTML = `<div style="color: #ff6b6b; padding: 8px;">参数解析失败: ${argumentsData}</div>`;
        argumentsData = null;
      }
    }
    
    if (argumentsData && typeof argumentsData === 'object') {
      for (const [key, value] of Object.entries(argumentsData)) {
        const item = document.createElement('div');
        item.className = 'tool-call-card-item';
        const keySpan = document.createElement('span');
        keySpan.className = 'tool-call-card-key';
        keySpan.textContent = key + ':';
        const valueSpan = document.createElement('span');
        valueSpan.className = 'tool-call-card-value';
        valueSpan.textContent = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        item.appendChild(keySpan);
        item.appendChild(valueSpan);
        modalArgs.appendChild(item);
      }
    } else if (argumentsData) {
      // 如果不是对象，直接显示
      const item = document.createElement('div');
      item.className = 'tool-call-card-item';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'tool-call-card-value';
      valueSpan.textContent = String(argumentsData);
      item.appendChild(valueSpan);
      modalArgs.appendChild(item);
    }
  }
  
  // 更新结果卡片
  updateOperationModalResult(modalResult, operationData.result);
  
  // 显示对话框
  modal.style.display = 'flex';
  currentOpenToolCallId = toolCallId;
  
  // 关闭按钮事件
  const closeModal = () => {
    modal.style.display = 'none';
    currentOpenToolCallId = null;
  };
  
  modalClose.onclick = closeModal;
  modal.querySelector('.operation-modal-overlay').onclick = closeModal;
  
  // ESC键关闭
  const handleEsc = (e) => {
    if (e.key === 'Escape' && modal.style.display === 'flex') {
      closeModal();
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);
}

// 更新操作对话框的结果部分
function updateOperationModalResult(modalResult, result) {
  modalResult.innerHTML = '';
  if (result) {
    for (const [key, value] of Object.entries(result)) {
      const item = document.createElement('div');
      item.className = 'tool-call-card-item';
      const keySpan = document.createElement('span');
      keySpan.className = 'tool-call-card-key';
      keySpan.textContent = key + ':';
      const valueSpan = document.createElement('span');
      valueSpan.className = 'tool-call-card-value';
      if (typeof value === 'object') {
        valueSpan.textContent = JSON.stringify(value, null, 2);
      } else {
        valueSpan.textContent = String(value);
      }
      item.appendChild(keySpan);
      item.appendChild(valueSpan);
      modalResult.appendChild(item);
    }
  } else {
    modalResult.innerHTML = '<div style="color: #808080; padding: 8px;">执行中...</div>';
  }
}

// 清空所有右侧卡片数据
function clearContextPanel() {
  // 清空思考内容
  thinkingContent.textContent = '';
  thinkingContent.classList.add('empty');
  
  // 清空TODO列表
  todoContent.innerHTML = '';
  todoContent.classList.add('empty');
  planningTodos = [];
  
  // 清空反思内容
  reflectionContent.innerHTML = '';
  reflectionContent.classList.add('empty');
  
  // 清空代码池
  codePoolContent.innerHTML = '';
  codePoolContent.classList.add('empty');
  
  // 清空备忘池
  memoPoolContent.innerHTML = '';
  memoPoolContent.classList.add('empty');
  
  // 清空操作池
  operationPoolContent.innerHTML = '';
  operationPoolContent.classList.add('empty');
  operationPoolMap.clear();
}

// 更新Context面板
function updateContextPanel(context) {
  try {
    // 先清空所有卡片
    clearContextPanel();
    
    // 先折叠所有卡片，然后根据需要展开
    collapseCard('thinking');
    collapseCard('planning');
    collapseCard('reflection');
    collapseCard('codePool');
    collapseCard('memoPool');
    collapseCard('operationPool');
    
    if (!context) {
      console.warn('[Renderer] updateContextPanel called with null/undefined context');
      return;
    }
    
    if (context.thinking) {
      thinkingContent.textContent = context.thinking;
      thinkingContent.classList.remove('empty');
      // 切换会话时，只展开TODO列表，其他卡片折叠
    }

    if (context.todos && context.todos.length > 0) {
      renderTodos(context.todos);
      expandCard('planning'); // 切换会话时，只展开TODO列表
    }

    if (context.reflections && context.reflections.length > 0) {
      reflectionContent.innerHTML = '';
      context.reflections.forEach(ref => {
        try {
          addReflection(ref);
        } catch (error) {
          console.error('[Renderer] Error adding reflection:', error, ref);
        }
      });
      // 切换会话时，其他卡片折叠
    }

    if (context.codePool && context.codePool.length > 0) {
      try {
        codePoolContent.innerHTML = context.codePool.map(code => 
          `<pre>${JSON.stringify(code, null, 2)}</pre>`
        ).join('');
        codePoolContent.classList.remove('empty');
      } catch (error) {
        console.error('[Renderer] Error restoring codePool:', error);
        codePoolContent.innerHTML = '<div style="color: #ff6b6b;">代码池数据加载失败</div>';
      }
      // 切换会话时，其他卡片折叠
    }

    if (context.memoPool && context.memoPool.length > 0) {
      memoPoolContent.innerHTML = '';
      context.memoPool.forEach(memo => {
        try {
          addMemo(memo);
        } catch (error) {
          console.error('[Renderer] Error adding memo:', error, memo);
        }
      });
      // 切换会话时，其他卡片折叠
    }

    if (context.operationPool && context.operationPool.length > 0) {
      operationPoolContent.innerHTML = '';
      operationPoolMap.clear();
      context.operationPool.forEach(op => {
        try {
          // 检查必要字段
          if (!op || !op.id || !op.tool) {
            console.warn('[Renderer] Invalid operation data:', op);
            return;
          }
          // 重新创建操作项（恢复时不展开卡片）
          const toolCall = {
            id: op.id,
            name: op.tool,
            arguments: op.args || {}
          };
          addOperationToPool(toolCall, false); // false表示不自动展开
          // 如果有结果，更新状态
          if (op.result) {
            updateOperationInPool(op.id, op.result);
          }
        } catch (error) {
          console.error('[Renderer] Error restoring operation:', error, op);
        }
      });
      // 切换会话时，其他卡片折叠
    }
  } catch (error) {
    console.error('[Renderer] Error in updateContextPanel:', error);
    // 确保面板仍然可见，即使有错误
  }
}

function estimateTokens(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherChars = text.length - chineseChars;
  return Math.ceil(chineseChars * 2 + otherChars * 0.75);
}

function updateProgress() {
  if (!appState.settings) return;

  let totalTokens = 0;
  const messages = chatMessages.querySelectorAll('.message-text');
  messages.forEach(msg => {
    totalTokens += estimateTokens(msg.textContent || '');
  });

  const maxTokens = appState.settings.maxContextLength || 16384;
  const percentage = Math.min((totalTokens / maxTokens) * 100, 100);

  progressFill.style.width = `${percentage}%`;
  progressText.textContent = `${totalTokens} / ${maxTokens} tokens`;

  if (percentage > 90) {
    progressFill.style.background = '#ff6b6b';
  } else if (percentage > 70) {
    progressFill.style.background = '#ffa500';
  } else {
    progressFill.style.background = 'linear-gradient(90deg, #667eea, #764ba2)';
  }
}

// 初始化
function startApp() {
  if (typeof window.electronAPI === 'undefined') {
    console.error('electronAPI is not available');
    setTimeout(startApp, 100); // 等待100ms后重试
    return;
  }
  initMarkdown();
  init().catch(error => {
    console.error('Failed to initialize app:', error);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp);
} else {
  startApp();
}
