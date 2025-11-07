/**
 * 会话历史管理器
 * 处理占位符机制：代码片段和工具调用结果用index占位符存储
 */
class MessageHistory {
  constructor() {
    this.history = []; // 存储消息历史（user和assistant）
    this.codePool = new Map(); // 存储代码片段，key为index
    this.toolResultPool = new Map(); // 存储工具调用结果，key为index
    this.nextCodeIndex = 1;
    this.nextToolIndex = 1;
  }

  /**
   * 添加消息（自动处理占位符）
   * 直接保存为OpenAI标准格式
   */
  addMessage(role, content, toolCalls = null) {
    // 提取代码片段和工具调用结果，用占位符替换
    let processedContent = content;
    
    // 处理代码块（简单匹配，实际可以更复杂）
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = content.match(codeBlockRegex) || [];
    codeBlocks.forEach(block => {
      const index = this.nextCodeIndex++;
      this.codePool.set(`code_${index}`, block);
      processedContent = processedContent.replace(block, `[CODE_${index}]`);
    });

    // 直接保存为OpenAI标准格式
    const message = {
      role: role,
      content: processedContent
    };
    
    // 如果有工具调用，转换为OpenAI标准格式（tool_calls）
    // 注意：不保存result字段，因为结果已经在tool消息中了
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      message.tool_calls = toolCalls.map(tc => {
        // 确保arguments是JSON字符串（OpenAI标准格式）
        let args = tc.arguments;
        if (typeof args === 'string') {
          // 如果已经是字符串，尝试验证是否为有效JSON
          try {
            JSON.parse(args);
          } catch (e) {
            // 如果不是有效JSON，转换为对象再序列化
            args = {};
          }
        } else if (args && typeof args === 'object') {
          // 如果是对象，序列化为JSON字符串
          args = JSON.stringify(args);
        } else {
          // 其他情况，使用空对象
          args = JSON.stringify({});
        }
        
        // 只保存id、type和function，不保存result（结果在tool消息中）
        return {
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: args
          }
        };
      });
    }

    this.history.push(message);
  }

  /**
   * 获取用于推理的消息历史（可选择是否还原占位符）
   * 由于已经保存为OpenAI标准格式，直接返回即可
   */
  getMessagesForInference(includeFullContent = false) {
    return this.history.map(msg => {
      // 如果是tool角色的消息，直接返回（已经符合OpenAI API格式）
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content
        };
      }
      
      let content = msg.content;
      
      if (includeFullContent) {
        // 还原代码片段
        content = content.replace(/\[CODE_(\d+)\]/g, (match, index) => {
          return this.codePool.get(`code_${index}`) || match;
        });
        
        // 还原工具调用结果
        content = content.replace(/\[TOOL_(\d+)\]/g, (match, index) => {
          const result = this.toolResultPool.get(`tool_${index}`);
          return result ? JSON.stringify(result) : match;
        });
      }
      
      // 直接返回消息（已经符合OpenAI格式，包括tool_calls）
      const message = {
        role: msg.role,
        content: content
      };
      
      // 如果有tool_calls，直接复制（已经是OpenAI格式）
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        message.tool_calls = msg.tool_calls;
      }
      
      // 兼容旧格式（toolCalls）
      if (!message.tool_calls && msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        message.tool_calls = msg.toolCalls.map(tc => {
          let args = tc.arguments;
          if (typeof args === 'string') {
            try {
              JSON.parse(args);
            } catch (e) {
              args = JSON.stringify({});
            }
          } else if (args && typeof args === 'object') {
            args = JSON.stringify(args);
          } else {
            args = JSON.stringify({});
          }
          return {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: args
            }
          };
        });
      }
      
      return message;
    });
  }

  /**
   * 获取当前轮次的消息（从最近一次用户消息开始到最新的消息）
   * 用于交互Agent，确保当前轮次的所有消息都作为messages传递，而不是放在context里
   * 由于已经保存为OpenAI标准格式，直接返回即可
   */
  getCurrentTurnMessages(includeFullContent = false) {
    // 找到最近一次用户消息的索引
    let lastUserIndex = -1;
    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].role === 'user') {
        lastUserIndex = i;
        break;
      }
    }
    
    // 如果没有找到用户消息，返回空数组
    if (lastUserIndex === -1) {
      return [];
    }
    
    // 返回从最近一次用户消息开始到最新的所有消息
    const currentTurnHistory = this.history.slice(lastUserIndex);
    
    return currentTurnHistory.map(msg => {
      // 如果是tool角色的消息，直接返回（已经符合OpenAI API格式）
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          tool_call_id: msg.tool_call_id,
          content: msg.content
        };
      }
      
      let content = msg.content;
      
      if (includeFullContent) {
        // 还原代码片段
        content = content.replace(/\[CODE_(\d+)\]/g, (match, index) => {
          return this.codePool.get(`code_${index}`) || match;
        });
        
        // 还原工具调用结果
        content = content.replace(/\[TOOL_(\d+)\]/g, (match, index) => {
          const result = this.toolResultPool.get(`tool_${index}`);
          return result ? JSON.stringify(result) : match;
        });
      }
      
      // 直接返回消息（已经符合OpenAI格式，包括tool_calls）
      const message = {
        role: msg.role,
        content: content
      };
      
      // 如果有tool_calls，直接复制（已经是OpenAI格式）
      if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        message.tool_calls = msg.tool_calls;
      }
      
      // 兼容旧格式（toolCalls）
      if (!message.tool_calls && msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
        message.tool_calls = msg.toolCalls.map(tc => {
          let args = tc.arguments;
          if (typeof args === 'string') {
            try {
              JSON.parse(args);
            } catch (e) {
              args = JSON.stringify({});
            }
          } else if (args && typeof args === 'object') {
            args = JSON.stringify(args);
          } else {
            args = JSON.stringify({});
          }
          return {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: args
            }
          };
        });
      }
      
      return message;
    });
  }

  /**
   * 添加工具调用结果
   */
  addToolResult(toolCallId, result) {
    const index = this.nextToolIndex++;
    this.toolResultPool.set(`tool_${index}`, result);
    return `[TOOL_${index}]`;
  }

  /**
   * 添加工具调用结果消息（tool角色）
   * 根据OpenAI API格式，工具调用结果应该作为tool角色的消息添加到历史中
   */
  addToolResultMessage(toolCallId, result) {
    const message = {
      role: 'tool',
      tool_call_id: toolCallId,
      content: typeof result === 'string' ? result : JSON.stringify(result),
      timestamp: Date.now()
    };
    this.history.push(message);
  }

  /**
   * 估算token数量
   */
  estimateTokens(includeFullContent = false) {
    const messages = this.getMessagesForInference(includeFullContent);
    let total = 0;
    
    messages.forEach(msg => {
      const chineseChars = (msg.content.match(/[\u4e00-\u9fa5]/g) || []).length;
      const otherChars = msg.content.length - chineseChars;
      total += Math.ceil(chineseChars * 2 + otherChars * 0.75);
    });
    
    return total;
  }

  /**
   * 压缩历史（当超过90%时）
   */
  async compress(compressionAgent) {
    if (this.estimateTokens(false) < 0.9 * 16384) {
      return; // 不需要压缩
    }

    const compressed = await compressionAgent.compressMessages(this.history);
    this.history = compressed;
  }

  /**
   * 序列化
   */
  toJSON() {
    return {
      history: this.history,
      codePool: Array.from(this.codePool.entries()),
      toolResultPool: Array.from(this.toolResultPool.entries()),
      nextCodeIndex: this.nextCodeIndex,
      nextToolIndex: this.nextToolIndex
    };
  }

  /**
   * 反序列化
   */
  fromJSON(data) {
    this.history = data.history || [];
    this.codePool = new Map(data.codePool || []);
    this.toolResultPool = new Map(data.toolResultPool || []);
    this.nextCodeIndex = data.nextCodeIndex || 1;
    this.nextToolIndex = data.nextToolIndex || 1;
  }
}

module.exports = MessageHistory;
