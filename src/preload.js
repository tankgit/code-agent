const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 应用状态
  getAppState: () => ipcRenderer.invoke('get-app-state'),
  getWorkDirectory: () => ipcRenderer.invoke('get-work-directory'),
  selectWorkDirectory: () => ipcRenderer.invoke('select-work-directory'),
  
  // 设置
  openSettings: () => ipcRenderer.invoke('open-settings'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getModels: () => ipcRenderer.invoke('get-models'),
  closeSettingsWindow: () => ipcRenderer.invoke('close-settings-window'),
  
  // 会话管理
  saveSession: (sessionId, sessionData) => ipcRenderer.invoke('save-session', sessionId, sessionData),
  loadSession: (sessionId) => ipcRenderer.invoke('load-session', sessionId),
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  deleteSession: (sessionId) => ipcRenderer.invoke('delete-session', sessionId),
  
  // 监听窗口事件
  onWindowReady: (callback) => {
    ipcRenderer.on('window-ready', callback);
  },
  
  // AI聊天相关（通过主进程处理）
  sendMessage: (message, sessionId) => ipcRenderer.invoke('send-message', message, sessionId),
  stopMessage: (sessionId) => ipcRenderer.invoke('stop-message', sessionId),
  onMessageChunk: (callback) => {
    ipcRenderer.on('message-chunk', (event, chunk) => callback(chunk));
  },
  
  // 工具调用
  callTool: (toolName, args) => ipcRenderer.invoke('call-tool', toolName, args),
  
  // 日志相关
  log: (level, ...args) => {
    ipcRenderer.invoke('renderer-log', level, args);
  }
});
