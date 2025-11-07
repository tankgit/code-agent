let settings = {};
let saveTimer = null;
const SAVE_DELAY = 500; // 500ms 延迟保存
let allModels = []; // 缓存模型列表

function getModelInput() {
  return document.getElementById('modelInput');
}

function getModelDropdown() {
  return document.getElementById('modelDropdown');
}

function renderModelDropdown(filterText = '') {
  const dropdown = getModelDropdown();
  if (!dropdown) return;

  const text = (filterText || '').trim().toLowerCase();
  const filtered = text
    ? allModels.filter(m => (m.name || m.id).toLowerCase().includes(text))
    : allModels;

  dropdown.innerHTML = '';

  if (!filtered.length) {
    dropdown.style.display = 'none';
    return;
  }

  filtered.forEach(model => {
    const optionEl = document.createElement('div');
    optionEl.className = 'combo-option';
    optionEl.textContent = model.name || model.id;
    optionEl.dataset.value = model.id;
    optionEl.addEventListener('mousedown', (e) => {
      // 使用 mousedown 以便在 input blur 前处理选择
      e.preventDefault();
      const input = getModelInput();
      input.value = model.id;
      dropdown.style.display = 'none';
      saveSettingsDebounced();
    });
    dropdown.appendChild(optionEl);
  });

  dropdown.style.display = 'block';
}

async function loadSettings() {
  settings = await window.electronAPI.getSettings();
  
  document.getElementById('apiKey').value = settings.apiKey || '';
  document.getElementById('apiUrl').value = settings.apiUrl || 'https://api.openai.com/v1';
  document.getElementById('httpProxy').value = settings.httpProxy || '';
  document.getElementById('httpsProxy').value = settings.httpsProxy || '';
  document.getElementById('noProxy').value = settings.noProxy || '';
  document.getElementById('maxContextLength').value = settings.maxContextLength || 16384;
  
  const modelInput = getModelInput();
  if (modelInput && settings.model) {
    modelInput.value = settings.model;
  }
  
  // 加载Agent设置
  loadAgentSettings(settings.agentSettings || {}, settings.model || '');
}

async function loadModels(showButton = true) {
  const loadBtn = document.getElementById('loadModelsBtn');
  
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
    allModels = Array.isArray(models) ? models : [];
    // 不自动渲染下拉框，只在用户点击或输入时才显示
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
  const baseSettings = {
    apiKey: document.getElementById('apiKey').value,
    apiUrl: document.getElementById('apiUrl').value,
    model: getModelInput().value,
    httpProxy: document.getElementById('httpProxy').value,
    httpsProxy: document.getElementById('httpsProxy').value,
    noProxy: document.getElementById('noProxy').value,
    maxContextLength: parseInt(document.getElementById('maxContextLength').value) || 16384
  };
  
  // 获取Agent设置
  const agentSettings = getAgentSettings();
  
  // 获取选中的工具列表
  const enabledTools = getEnabledTools();
  
  return {
    ...baseSettings,
    agentSettings,
    enabledTools
  };
}

// Agent配置映射
const agentConfigs = {
  thinking: {
    checkbox: 'thinkingCustomCheckbox',
    content: 'thinkingConfigContent',
    modelInput: 'thinkingModelInput',
    modelDropdown: 'thinkingModelDropdown',
    apiUrl: 'thinkingApiUrl',
    apiKey: 'thinkingApiKey',
    modelName: 'thinkingModelName'
  },
  contextSelection: {
    checkbox: 'contextSelectionCustomCheckbox',
    content: 'contextSelectionConfigContent',
    modelInput: 'contextSelectionModelInput',
    modelDropdown: 'contextSelectionModelDropdown',
    apiUrl: 'contextSelectionApiUrl',
    apiKey: 'contextSelectionApiKey',
    modelName: 'contextSelectionModelName'
  },
  planning: {
    checkbox: 'planningCustomCheckbox',
    content: 'planningConfigContent',
    modelInput: 'planningModelInput',
    modelDropdown: 'planningModelDropdown',
    apiUrl: 'planningApiUrl',
    apiKey: 'planningApiKey',
    modelName: 'planningModelName'
  },
  reflection: {
    checkbox: 'reflectionCustomCheckbox',
    content: 'reflectionConfigContent',
    modelInput: 'reflectionModelInput',
    modelDropdown: 'reflectionModelDropdown',
    apiUrl: 'reflectionApiUrl',
    apiKey: 'reflectionApiKey',
    modelName: 'reflectionModelName'
  },
  interaction: {
    checkbox: 'interactionCustomCheckbox',
    content: 'interactionConfigContent',
    modelInput: 'interactionModelInput',
    modelDropdown: 'interactionModelDropdown',
    apiUrl: 'interactionApiUrl',
    apiKey: 'interactionApiKey',
    modelName: 'interactionModelName'
  },
  compression: {
    checkbox: 'compressionCustomCheckbox',
    content: 'compressionConfigContent',
    modelInput: 'compressionModelInput',
    modelDropdown: 'compressionModelDropdown',
    apiUrl: 'compressionApiUrl',
    apiKey: 'compressionApiKey',
    modelName: 'compressionModelName'
  }
};

function loadAgentSettings(agentSettings, defaultModel) {
  Object.keys(agentConfigs).forEach(agentKey => {
    const config = agentConfigs[agentKey];
    const agentSetting = agentSettings[agentKey];
    const modelInput = document.getElementById(config.modelInput);
    
    // 设置默认模型的占位符
    if (modelInput) {
      if (defaultModel) {
        modelInput.placeholder = `默认模型: ${defaultModel}`;
      } else {
        modelInput.placeholder = '选择或输入模型（不选择则使用默认模型）';
      }
    }
    
    const checkbox = document.getElementById(config.checkbox);
    
    if (agentSetting && agentSetting.enabled) {
      // 加载设置值
      const apiUrlInput = document.getElementById(config.apiUrl);
      const apiKeyInput = document.getElementById(config.apiKey);
      const modelNameInput = document.getElementById(config.modelName);
      
      if (agentSetting.useCustom) {
        // 使用自定义输入（api_url, api_key, model_name）
        if (checkbox) {
          checkbox.checked = true;
          toggleAgentConfig(agentKey, true);
        }
        
        if (apiUrlInput) apiUrlInput.value = agentSetting.apiUrl || '';
        if (apiKeyInput) apiKeyInput.value = agentSetting.apiKey || '';
        if (modelNameInput) modelNameInput.value = agentSetting.model || '';
        
        // 显示自定义输入框，隐藏下拉框
        showCustomInputs(agentKey);
      } else {
        // 使用下拉框选择模型（使用默认的apiKey和apiUrl），不勾选复选框
        if (checkbox) {
          checkbox.checked = false;
          toggleAgentConfig(agentKey, false);
        }
        
        if (modelInput && agentSetting.model) {
          modelInput.value = agentSetting.model;
        }
        
        // 显示下拉框，隐藏自定义输入框
        showModelDropdown(agentKey);
      }
    } else {
      // 未启用自定义模型，但可能使用了下拉框选择模型
      if (checkbox) {
        checkbox.checked = false;
        toggleAgentConfig(agentKey, false);
      }
      
      // 检查是否有下拉框选择的模型
      if (modelInput && agentSetting && agentSetting.model) {
        modelInput.value = agentSetting.model;
        // 显示下拉框
        showModelDropdown(agentKey);
      } else {
        // 如果没有设置，默认显示下拉框（占位符已设置）
        showModelDropdown(agentKey);
      }
    }
  });
}

function getAgentSettings() {
  const agentSettings = {};
  
  Object.keys(agentConfigs).forEach(agentKey => {
    const config = agentConfigs[agentKey];
    const checkbox = document.getElementById(config.checkbox);
    
    if (checkbox && checkbox.checked) {
      // 复选框选中，使用自定义输入框模式
      const apiUrlInput = document.getElementById(config.apiUrl);
      const apiKeyInput = document.getElementById(config.apiKey);
      const modelNameInput = document.getElementById(config.modelName);
      
      agentSettings[agentKey] = {
        enabled: true,
        useCustom: true, // 复选框选中时，使用自定义模式
        model: modelNameInput ? modelNameInput.value.trim() : '',
        apiUrl: apiUrlInput ? apiUrlInput.value.trim() : '',
        apiKey: apiKeyInput ? apiKeyInput.value.trim() : ''
      };
    } else {
      // 复选框未选中，使用下拉框选择模型（使用默认apiKey和apiUrl）
      const modelInput = document.getElementById(config.modelInput);
      if (modelInput && modelInput.value.trim() !== '') {
        agentSettings[agentKey] = {
          enabled: true,
          useCustom: false, // 使用下拉框模式，使用默认apiKey和apiUrl
          model: modelInput.value.trim()
        };
      }
    }
  });
  
  return agentSettings;
}

function toggleAgentConfig(agentKey, enabled) {
  const config = agentConfigs[agentKey];
  const content = document.getElementById(config.content);
  
  // 配置区域始终显示（无论复选框是否选中）
  // 只是切换显示下拉框还是自定义输入框
  if (content) {
    content.classList.remove('hidden');
  }
}

function showCustomInputs(agentKey) {
  const config = agentConfigs[agentKey];
  const modelSelector = document.getElementById(`${agentKey}ModelSelector`);
  const customInputs = document.getElementById(`${agentKey}CustomInputs`);
  
  // 隐藏下拉框，显示自定义输入框
  if (modelSelector) {
    modelSelector.classList.add('hidden');
  }
  if (customInputs) {
    customInputs.classList.remove('hidden');
  }
}

function showModelDropdown(agentKey) {
  const config = agentConfigs[agentKey];
  const modelSelector = document.getElementById(`${agentKey}ModelSelector`);
  const customInputs = document.getElementById(`${agentKey}CustomInputs`);
  
  // 显示下拉框，隐藏自定义输入框
  if (modelSelector) {
    modelSelector.classList.remove('hidden');
  }
  if (customInputs) {
    customInputs.classList.add('hidden');
  }
}

function renderAgentModelDropdown(agentKey, filterText = '') {
  const config = agentConfigs[agentKey];
  const dropdown = document.getElementById(config.modelDropdown);
  if (!dropdown) return;

  const text = (filterText || '').trim().toLowerCase();
  const filtered = text
    ? allModels.filter(m => (m.name || m.id).toLowerCase().includes(text))
    : allModels;

  dropdown.innerHTML = '';

  if (!filtered.length) {
    dropdown.style.display = 'none';
    return;
  }

  filtered.forEach(model => {
    const optionEl = document.createElement('div');
    optionEl.className = 'combo-option';
    optionEl.textContent = model.name || model.id;
    optionEl.dataset.value = model.id;
    optionEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const input = document.getElementById(config.modelInput);
      if (input) {
        input.value = model.id;
        dropdown.style.display = 'none';
        saveSettingsDebounced();
      }
    });
    dropdown.appendChild(optionEl);
  });

  dropdown.style.display = 'block';
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
    'proxy': '代理设置',
    'agent': 'Agent设置',
    'tools': '工具设置'
  };
  sectionTitle.textContent = sectionNames[sectionName] || '设置';
  
  // 如果切换到工具设置页签，加载工具列表
  if (sectionName === 'tools') {
    loadToolsList().then(() => {
      // 加载完成后恢复选中状态
      if (settings.enabledTools && Array.isArray(settings.enabledTools)) {
        restoreToolSelection(settings.enabledTools);
      }
    });
  }
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
  
  // 模型可输入下拉
  const modelInput = getModelInput();
  const modelDropdown = getModelDropdown();
  if (modelInput && modelDropdown) {
    // 确保初始状态下下拉框是隐藏的
    modelDropdown.style.display = 'none';
    
    modelInput.addEventListener('input', (e) => {
      renderModelDropdown(modelInput.value);
      saveSettingsDebounced();
    });
    modelInput.addEventListener('focus', () => {
      // 只有在用户主动点击输入框时才显示下拉框
      if (allModels.length > 0) {
        renderModelDropdown(modelInput.value);
      }
    });
    modelInput.addEventListener('blur', () => {
      // 延迟隐藏以允许点击选项
      setTimeout(() => {
        modelDropdown.style.display = 'none';
      }, 100);
    });
  }
  
  // 加载模型按钮
  document.getElementById('loadModelsBtn').addEventListener('click', () => loadModels(true));
  
  // 自动加载模型列表（静默加载，不显示按钮状态）
  if (settings.apiKey && settings.apiUrl) {
    loadModels(false);
  }
  
  // 初始化Agent设置
  initializeAgentSettings();
  
  // 初始化工具详情弹窗
  initializeToolDetailModal();
});

// 工具列表相关函数
let toolsList = [];
let enabledTools = new Set(); // 使用Set存储选中的工具名称

async function loadToolsList() {
  try {
    toolsList = await window.electronAPI.listTools();
    // 加载保存的选中状态
    if (settings.enabledTools && Array.isArray(settings.enabledTools)) {
      enabledTools = new Set(settings.enabledTools);
    } else {
      // 默认全部选中
      enabledTools = new Set(toolsList.map(t => t.name));
    }
    renderToolsList();
  } catch (error) {
    console.error('Failed to load tools list:', error);
    const toolsListEl = document.getElementById('toolsList');
    if (toolsListEl) {
      toolsListEl.innerHTML = '<div style="color: #ff6b6b;">加载工具列表失败</div>';
    }
  }
}

function renderToolsList() {
  const toolsListEl = document.getElementById('toolsList');
  if (!toolsListEl) return;
  
  if (!toolsList || toolsList.length === 0) {
    toolsListEl.innerHTML = '<div style="color: #a0a0a0;">暂无可用工具</div>';
    return;
  }
  
  toolsListEl.innerHTML = toolsList.map(tool => {
    const isSelected = enabledTools.has(tool.name);
    return `
    <div class="tool-card ${isSelected ? 'selected' : ''}" data-tool-name="${tool.name}">
      <div class="tool-card-header">
        <div class="tool-card-name">${escapeHtml(tool.displayName)}</div>
        <button class="tool-card-detail-btn" data-tool-name="${tool.name}" title="查看详情">🔍</button>
      </div>
      <div class="tool-card-description">${escapeHtml(tool.description)}</div>
    </div>
  `;
  }).join('');
  
  // 为每个卡片添加点击事件（选中/取消选中）
  toolsListEl.querySelectorAll('.tool-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // 如果点击的是详情按钮，不触发选中
      if (e.target.classList.contains('tool-card-detail-btn')) {
        return;
      }
      toggleToolSelection(card.dataset.toolName);
    });
  });
  
  // 为详情按钮添加点击事件
  toolsListEl.querySelectorAll('.tool-card-detail-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // 阻止事件冒泡
      const toolName = btn.dataset.toolName;
      const tool = toolsList.find(t => t.name === toolName);
      if (tool) {
        showToolDetail(tool);
      }
    });
  });
}

function toggleToolSelection(toolName) {
  if (enabledTools.has(toolName)) {
    enabledTools.delete(toolName);
  } else {
    enabledTools.add(toolName);
  }
  
  // 更新UI
  const card = document.querySelector(`.tool-card[data-tool-name="${toolName}"]`);
  if (card) {
    if (enabledTools.has(toolName)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  }
  
  // 保存设置
  saveSettingsDebounced();
}

function restoreToolSelection(enabledToolNames) {
  enabledTools = new Set(enabledToolNames);
  // 更新UI
  document.querySelectorAll('.tool-card').forEach(card => {
    const toolName = card.dataset.toolName;
    if (enabledTools.has(toolName)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
}

function getEnabledTools() {
  return Array.from(enabledTools);
}

function showToolDetail(tool) {
  const modal = document.getElementById('toolDetailModal');
  const titleEl = document.getElementById('toolDetailTitle');
  const nameEl = document.getElementById('toolDetailName');
  const descriptionEl = document.getElementById('toolDetailDescription');
  const paramsEl = document.getElementById('toolDetailParams');
  
  if (!modal || !titleEl || !nameEl || !descriptionEl || !paramsEl) return;
  
  // 设置基本信息
  titleEl.textContent = tool.displayName;
  nameEl.textContent = tool.name;
  descriptionEl.textContent = tool.description;
  
  // 渲染参数
  if (tool.schema && tool.schema.properties) {
    const requiredParams = tool.schema.required || [];
    const properties = tool.schema.properties;
    
    paramsEl.innerHTML = Object.keys(properties).map(paramName => {
      const param = properties[paramName];
      const isRequired = requiredParams.includes(paramName);
      
      return `
        <div class="tool-param-item">
          <div class="tool-param-name">
            ${escapeHtml(paramName)}
            <span class="${isRequired ? 'tool-param-required' : 'tool-param-optional'}">
              ${isRequired ? '必填' : '可选'}
            </span>
          </div>
          ${param.type ? `<div class="tool-param-type">类型: ${escapeHtml(param.type)}</div>` : ''}
          ${param.description ? `<div class="tool-param-description">${escapeHtml(param.description)}</div>` : ''}
        </div>
      `;
    }).join('');
  } else {
    paramsEl.innerHTML = '<div style="color: #a0a0a0;">此工具无参数</div>';
  }
  
  // 显示弹窗
  modal.classList.add('active');
}

function initializeToolDetailModal() {
  const modal = document.getElementById('toolDetailModal');
  const closeBtn = document.getElementById('toolDetailClose');
  
  if (!modal || !closeBtn) return;
  
  // 关闭按钮点击事件
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });
  
  // 点击背景关闭
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
  
  // ESC 键关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      modal.classList.remove('active');
    }
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function initializeAgentSettings() {
  // 为每个Agent设置复选框切换事件
  Object.keys(agentConfigs).forEach(agentKey => {
    const config = agentConfigs[agentKey];
    const checkbox = document.getElementById(config.checkbox);
    const modelInput = document.getElementById(config.modelInput);
    const modelDropdown = document.getElementById(config.modelDropdown);
    const apiUrlInput = document.getElementById(config.apiUrl);
    const apiKeyInput = document.getElementById(config.apiKey);
    const modelNameInput = document.getElementById(config.modelName);
    
    if (checkbox) {
      checkbox.addEventListener('change', (e) => {
        const enabled = e.target.checked;
        // 配置区域始终显示，只是切换显示内容
        toggleAgentConfig(agentKey, true);
        
        if (enabled) {
          // 选中复选框后，显示三个输入框（自定义模式），隐藏下拉框
          showCustomInputs(agentKey);
        } else {
          // 未选中复选框，显示下拉框（选择模型，使用默认apiKey和apiUrl），隐藏自定义输入框
          showModelDropdown(agentKey);
        }
        
        saveSettingsDebounced();
      });
    }
    
    // 模型输入框事件（下拉框模式）
    if (modelInput && modelDropdown) {
      // 确保初始状态下下拉框是隐藏的
      if (modelDropdown) {
        modelDropdown.style.display = 'none';
      }
      
      modelInput.addEventListener('input', (e) => {
        renderAgentModelDropdown(agentKey, modelInput.value);
        saveSettingsDebounced();
      });
      
      modelInput.addEventListener('focus', () => {
        // 只有在用户主动点击输入框时才显示下拉框
        if (allModels.length > 0) {
          renderAgentModelDropdown(agentKey, modelInput.value);
        }
      });
      
      modelInput.addEventListener('blur', () => {
        setTimeout(() => {
          if (modelDropdown) {
            modelDropdown.style.display = 'none';
          }
        }, 100);
      });
    }
    
    // 自定义输入框事件（复选框选中后使用）
    if (apiUrlInput) {
      apiUrlInput.addEventListener('input', saveSettingsDebounced);
    }
    
    if (apiKeyInput) {
      apiKeyInput.addEventListener('input', saveSettingsDebounced);
    }
    
    if (modelNameInput) {
      modelNameInput.addEventListener('input', saveSettingsDebounced);
    }
  });
}
