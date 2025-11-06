const fs = require('fs');
const path = require('path');

/**
 * Prompt 加载器：从文件系统加载 agent 的 system prompt
 */
class PromptLoader {
  constructor() {
    this.promptsDir = path.join(__dirname, 'prompts');
    this.cache = {}; // 缓存已加载的 prompt
  }

  /**
   * 加载指定 agent 的 system prompt
   * @param {string} agentName - Agent 名称（如 'ThinkingAgent'）
   * @param {object} variables - 可选的变量替换（如 {CONTEXTS: '...'}）
   * @returns {string} - System prompt 内容
   */
  load(agentName, variables = {}) {
    // 检查缓存
    const cacheKey = `${agentName}_${JSON.stringify(variables)}`;
    if (this.cache[cacheKey]) {
      return this.cache[cacheKey];
    }

    try {
      const promptFile = path.join(this.promptsDir, `${agentName}.txt`);
      
      if (!fs.existsSync(promptFile)) {
        console.warn(`[PromptLoader] Prompt file not found: ${promptFile}`);
        return '';
      }

      let prompt = fs.readFileSync(promptFile, 'utf-8').trim();
      
      // 替换变量
      for (const [key, value] of Object.entries(variables)) {
        const placeholder = `{{${key}}}`;
        prompt = prompt.replace(new RegExp(placeholder, 'g'), value || '');
      }

      // 缓存结果
      this.cache[cacheKey] = prompt;
      
      return prompt;
    } catch (error) {
      console.error(`[PromptLoader] Failed to load prompt for ${agentName}:`, error);
      return '';
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache = {};
  }

  /**
   * 获取所有可用的 prompt 文件名
   */
  listAvailable() {
    try {
      const files = fs.readdirSync(this.promptsDir);
      return files
        .filter(file => file.endsWith('.txt'))
        .map(file => file.replace('.txt', ''));
    } catch (error) {
      console.error('[PromptLoader] Failed to list prompts:', error);
      return [];
    }
  }
}

// 创建单例
const promptLoader = new PromptLoader();

module.exports = promptLoader;
