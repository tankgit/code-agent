let settings = {};
let saveTimer = null;
const SAVE_DELAY = 500; // 500ms 延迟保存

async function loadSettings() {
  settings = await window.electronAPI.getSettings();
  
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('apiUrl').value = settings.apiUrl || 'https://api.openai.com/v1';
  document.getElementById('httpProxy').value = settings.httpProxy || '';
  document.getElementById('httpsProxy').value = settings.httpsProxy || '';
  document.getElementById('noProxy').value = settings.noProxy || '';
  document.getElementById('maxContextLength').value = settings.maxContextLength || 16384;
  
  if (settings.model) {
    const modelSelect = document.getElementById('model');
    const option = document.createElement('option');
    option.value = settings.model;
    option.textContent = settings.model;
    modelSelect.appendChild(option);
    modelSelect.value = settings.model;
  }
}

async function loadModels(showButton = true) {
  const loadBtn = document.getElementById('loadModelsBtn');
  const modelSelect = document.getElementById('model');
  
  if (showButton) {
    loadBtn.disabled = true;
    loadBtn.textContent = '加载中...';
  }
  
  try {
    // 设置5秒超时
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('请求超时（5秒）')), 5000);
    });
    
    const modelsPromise = window.electronAPI.getModels();
    const models = await Promise.race([modelsPromise, timeoutPromise]);
    
    modelSelect.innerHTML = '<option value="">请选择模型</option>';
    
    if (models && models.length > 0) {
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = model.name;
        modelSelect.appendChild(option);
      });
      
      if (settings.model) {
        modelSelect.value = settings.model;
      }
    }
  } catch (error) {
    if (showButton) {
      alert('加载模型列表失败: ' + error.message);
    } else {
      console.warn('自动加载模型列表失败:', error.message);
      // 静默失败，不显示错误提示
    }
  } finally {
    if (showButton) {
      loadBtn.disabled = false;
      loadBtn.textContent = '加载模型列表';
    }
  }
}

async function closeWindow() {
  // 关闭前保存一次
  await saveSettingsNow();
  if (window.electronAPI && window.electronAPI.closeSettingsWindow) {
    await window.electronAPI.closeSettingsWindow();
  } else {
    // 备用方案：直接关闭
    window.close();
  }
}

function getCurrentSettings() {
  return {
    apiKey: document.getElementById('apiKey').value,
    apiUrl: document.getElementById('apiUrl').value,
    model: document.getElementById('model').value,
    httpProxy: document.getElementById('httpProxy').value,
    httpsProxy: document.getElementById('httpsProxy').value,
    noProxy: document.getElementById('noProxy').value,
    maxContextLength: parseInt(document.getElementById('maxContextLength').value) || 16384
  };
}

async function saveSettingsNow() {
  const newSettings = getCurrentSettings();
  try {
    await window.electronAPI.saveSettings(newSettings);
    console.log('Settings saved');
  } catch (error) {
    console.error('Failed to save settings:', error);
  }
}

// 防抖保存函数
function saveSettingsDebounced() {
  // 清除之前的定时器
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  
  // 设置新的定时器
  saveTimer = setTimeout(() => {
    saveSettingsNow();
  }, SAVE_DELAY);
}

function updateApiUrlPreview() {
  const apiUrlInput = document.getElementById('apiUrl');
  const previewText = document.getElementById('apiUrlPreviewText');
  
  let baseUrl = apiUrlInput.value.trim();
  if (!baseUrl) {
    previewText.textContent = '-';
    return;
  }
  
  // 移除末尾的斜杠
  baseUrl = baseUrl.replace(/\/+$/, '');
  
  // 构建完整路径
  const fullUrl = baseUrl + '/chat/completions';
  previewText.textContent = fullUrl;
}

function switchSection(sectionName) {
  // 隐藏所有section
  document.querySelectorAll('.settings-section').forEach(section => {
    section.classList.remove('active');
  });
  
  // 显示选中的section
  document.getElementById(sectionName + 'Section').classList.add('active');
  
  // 更新侧边栏状态
  document.querySelectorAll('.settings-sidebar-item').forEach(item => {
    item.classList.remove('active');
    if (item.dataset.section === sectionName) {
      item.classList.add('active');
    }
  });
  
  // 更新标题
  const sectionTitle = document.getElementById('sectionTitle');
  const sectionNames = {
    'model': '模型设置',
    'proxy': '代理设置'
  };
  sectionTitle.textContent = sectionNames[sectionName] || '设置';
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  
  // 关闭按钮
  document.getElementById('closeBtn').addEventListener('click', closeWindow);
  
  // 侧边栏切换
  document.querySelectorAll('.settings-sidebar-item').forEach(item => {
    item.addEventListener('click', () => {
      switchSection(item.dataset.section);
    });
  });
  
  // ESC 键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeWindow();
    }
  });
  
  // 阻止点击设置容器和侧边栏时关闭
  const settingsContainer = document.getElementById('settingsContainer');
  const sidebar = document.querySelector('.settings-sidebar');
  
  // 阻止点击设置容器和侧边栏时关闭
  settingsContainer.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  sidebar.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  
  // API URL 预览和实时保存
  const apiUrlInput = document.getElementById('apiUrl');
  apiUrlInput.addEventListener('input', () => {
    updateApiUrlPreview();
    saveSettingsDebounced();
  });
  updateApiUrlPreview(); // 初始化预览
  
  // 为所有输入框添加实时保存
  document.getElementById('apiKey').addEventListener('input', saveSettingsDebounced);
  document.getElementById('httpProxy').addEventListener('input', saveSettingsDebounced);
  document.getElementById('httpsProxy').addEventListener('input', saveSettingsDebounced);
  document.getElementById('noProxy').addEventListener('input', saveSettingsDebounced);
  document.getElementById('maxContextLength').addEventListener('input', saveSettingsDebounced);
  document.getElementById('maxContextLength').addEventListener('change', saveSettingsDebounced);
  
  // 模型选择框
  document.getElementById('model').addEventListener('change', saveSettingsDebounced);
  
  // 加载模型按钮
  document.getElementById('loadModelsBtn').addEventListener('click', () => loadModels(true));
  
  // 自动加载模型列表（静默加载，不显示按钮状态）
  if (settings.apiKey && settings.apiUrl) {
    loadModels(false);
  }
});
