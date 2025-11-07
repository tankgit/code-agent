const axios = require('axios');

/**
 * Agent基类
 */
class Agent {
  constructor(settings, workDirectory = null) {
    this.settings = settings;
    this.workDirectory = workDirectory;
    this.name = 'Agent';
  }

  /**
   * 配置HTTP客户端（包括代理设置）
   */
  getHttpConfig() {
    const config = {
      headers: {
        'Authorization': `Bearer ${this.settings.apiKey}`,
        'Content-Type': 'application/json'
      }
    };

    // 配置代理 - 使用 axios 的 proxy 配置，支持带认证的代理格式
    // 格式：http://username:password@proxy_address:port
    // 对于 HTTPS 请求，优先使用 httpsProxy，否则使用 httpProxy
    if (this.settings.httpsProxy) {
      config.proxy = this.settings.httpsProxy;
    } else if (this.settings.httpProxy) {
      config.proxy = this.settings.httpProxy;
    }

    return config;
  }

  /**
   * 调用API（流式）
   */
  async *streamChat(messages, tools = null, toolChoice = null) {
    console.log(`[${this.name}] streamChat called`, { 
      messagesCount: messages ? messages.length : 0,
      hasTools: !!tools,
      toolsCount: tools ? tools.length : 0,
      toolChoice
    });
    
    // 验证必要参数
    if (!this.settings.apiKey) {
      console.error(`[${this.name}] streamChat failed: no API key`);
      throw new Error('API密钥未设置，请在设置中配置API密钥');
    }
    if (!this.settings.model) {
      console.error(`[${this.name}] streamChat failed: no model`);
      throw new Error('模型未设置，请在设置中选择模型');
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error(`[${this.name}] streamChat failed: invalid messages`, { messages });
      throw new Error('消息列表为空或格式无效');
    }

    const url = `${this.settings.apiUrl}/chat/completions`;
    const config = this.getHttpConfig();

    const payload = {
      model: this.settings.model,
      messages: messages,
      stream: true,
      max_tokens: this.settings.maxContextLength
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      if (toolChoice) {
        payload.tool_choice = toolChoice;
      }
    }

    console.log(`[${this.name}] Making API request`, { 
      url, 
      model: payload.model, 
      messagesCount: messages.length,
      hasTools: !!tools,
      toolsCount: tools ? tools.length : 0
    });

    try {
      const response = await axios.post(url, payload, {
        ...config,
        responseType: 'stream'
      });

      console.log(`[${this.name}] API response received`, { 
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });

      let buffer = '';
      let rawChunkCount = 0;
      let parsedChunkCount = 0;
      let contentChunkCount = 0;
      let toolCallChunkCount = 0;
      let totalContentLength = 0;

      for await (const chunk of response.data) {
        rawChunkCount++;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              console.log(`[${this.name}] Stream completed [DONE]`, { 
                rawChunks: rawChunkCount,
                parsedChunks: parsedChunkCount,
                contentChunks: contentChunkCount,
                toolCallChunks: toolCallChunkCount,
                totalContentLength
              });
              return;
            }
            try {
              const parsed = JSON.parse(data);
              parsedChunkCount++;
              
              if (parsed.choices && parsed.choices[0]) {
                const delta = parsed.choices[0].delta;
                
                if (delta.content) {
                  contentChunkCount++;
                  totalContentLength += delta.content.length;
                  console.log(`[${this.name}] Yielding content`, { 
                    chunkNumber: contentChunkCount,
                    length: delta.content.length,
                    totalLength: totalContentLength,
                    preview: delta.content.substring(0, 50)
                  });
                  yield delta.content;
                }
                
                if (delta.tool_calls && delta.tool_calls.length > 0) {
                  toolCallChunkCount++;
                  console.log(`[${this.name}] Yielding tool_calls`, { 
                    chunkNumber: toolCallChunkCount,
                    toolCallsCount: delta.tool_calls.length
                  });
                  yield { tool_calls: delta.tool_calls };
                }
              } else {
                console.log(`[${this.name}] Parsed chunk has no choices`, { parsed });
              }
            } catch (e) {
              console.warn(`[${this.name}] Failed to parse chunk data`, { error: e.message, data: data.substring(0, 100) });
              // 忽略解析错误
            }
          }
        }
      }
      
      console.log(`[${this.name}] Stream ended`, { 
        rawChunks: rawChunkCount,
        parsedChunks: parsedChunkCount,
        contentChunks: contentChunkCount,
        toolCallChunks: toolCallChunkCount,
        totalContentLength,
        remainingBuffer: buffer.length
      });
    } catch (error) {
      console.error(`[${this.name}] API request failed`, { error: error.message, url });
      // 提取更详细的错误信息
      let errorMessage = error.message;
      
      if (error.response) {
        // API返回了错误响应
        const statusCode = error.response.status;
        const errorData = error.response.data;
        
        // 对于流式响应，错误数据可能是流，需要读取
        if (errorData) {
          try {
            // 检查是否是流对象
            if (typeof errorData === 'object' && errorData.pipe && typeof errorData.on === 'function') {
              // 这是一个流，尝试读取
              const chunks = [];
              for await (const chunk of errorData) {
                chunks.push(chunk);
              }
              const errorText = Buffer.concat(chunks).toString();
              try {
                const parsed = JSON.parse(errorText);
                if (parsed.error && parsed.error.message) {
                  errorMessage = parsed.error.message;
                } else {
                  errorMessage = errorText;
                }
              } catch (e) {
                errorMessage = errorText || errorMessage;
              }
            } else if (errorData.error) {
              // OpenAI格式的错误
              errorMessage = errorData.error.message || errorData.error.code || errorMessage;
            } else if (typeof errorData === 'string') {
              errorMessage = errorData;
            } else if (typeof errorData === 'object') {
              errorMessage = JSON.stringify(errorData);
            }
          } catch (e) {
            // 如果读取流失败，使用默认错误信息
            console.error('Error reading error stream:', e);
          }
        }
        
        // 根据状态码提供更友好的提示
        if (statusCode === 400) {
          errorMessage = `请求参数错误: ${errorMessage}`;
        } else if (statusCode === 401) {
          errorMessage = `认证失败: API密钥无效或已过期`;
        } else if (statusCode === 404) {
          errorMessage = `API端点不存在: 请检查API URL配置`;
        } else if (statusCode === 429) {
          errorMessage = `请求频率过高: 请稍后重试`;
        } else if (statusCode >= 500) {
          errorMessage = `服务器错误 (${statusCode}): ${errorMessage}`;
        }
      } else if (error.request) {
        // 请求已发送但没有收到响应
        errorMessage = `无法连接到API服务器: 请检查网络连接和API URL配置`;
      }
      
      throw new Error(`API调用失败: ${errorMessage}`);
    }
  }

  /**
   * 调用API（非流式）
   */
  async callChat(messages, tools = null, toolChoice = null) {
    console.log(`[${this.name}] callChat called`, { 
      messagesCount: messages ? messages.length : 0,
      hasTools: !!tools,
      toolsCount: tools ? tools.length : 0,
      toolChoice
    });
    
    // 验证必要参数
    if (!this.settings.apiKey) {
      console.error(`[${this.name}] callChat failed: no API key`);
      throw new Error('API密钥未设置，请在设置中配置API密钥');
    }
    if (!this.settings.model) {
      console.error(`[${this.name}] callChat failed: no model`);
      throw new Error('模型未设置，请在设置中选择模型');
    }
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      console.error(`[${this.name}] callChat failed: invalid messages`, { messages });
      throw new Error('消息列表为空或格式无效');
    }

    const url = `${this.settings.apiUrl}/chat/completions`;
    const config = this.getHttpConfig();

    const payload = {
      model: this.settings.model,
      messages: messages,
      max_tokens: this.settings.maxContextLength
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      if (toolChoice) {
        payload.tool_choice = toolChoice;
      }
    }

    console.log(`[${this.name}] Making API request (non-stream)`, { 
      url, 
      model: payload.model, 
      messagesCount: messages.length,
      hasTools: !!tools
    });

    try {
      const response = await axios.post(url, payload, config);
      console.log(`[${this.name}] API response received (non-stream)`, { 
        status: response.status,
        hasData: !!response.data,
        choicesCount: response.data?.choices ? response.data.choices.length : 0
      });
      
      if (response.data?.choices?.[0]?.message?.content) {
        console.log(`[${this.name}] Response content length:`, response.data.choices[0].message.content.length);
      }
      
      return response.data;
    } catch (error) {
      console.error(`[${this.name}] API request failed (non-stream)`, { error: error.message, url });
      // 提取更详细的错误信息
      let errorMessage = error.message;
      
      if (error.response) {
        // API返回了错误响应
        const statusCode = error.response.status;
        const errorData = error.response.data;
        
        if (errorData && errorData.error) {
          // OpenAI格式的错误
          errorMessage = errorData.error.message || errorData.error.code || errorMessage;
        } else if (typeof errorData === 'string') {
          errorMessage = errorData;
        } else if (errorData) {
          errorMessage = JSON.stringify(errorData);
        }
        
        // 根据状态码提供更友好的提示
        if (statusCode === 400) {
          errorMessage = `请求参数错误: ${errorMessage}`;
        } else if (statusCode === 401) {
          errorMessage = `认证失败: API密钥无效或已过期`;
        } else if (statusCode === 404) {
          errorMessage = `API端点不存在: 请检查API URL配置`;
        } else if (statusCode === 429) {
          errorMessage = `请求频率过高: 请稍后重试`;
        } else if (statusCode >= 500) {
          errorMessage = `服务器错误 (${statusCode}): ${errorMessage}`;
        }
      } else if (error.request) {
        // 请求已发送但没有收到响应
        errorMessage = `无法连接到API服务器: 请检查网络连接和API URL配置`;
      }
      
      throw new Error(`API调用失败: ${errorMessage}`);
    }
  }

  /**
   * 估算token数量（简单估算，实际应该使用tiktoken等库）
   */
  estimateTokens(text) {
    // 简单估算：中文字符按2个token，英文按0.75个token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars * 2 + otherChars * 0.75);
  }
}

module.exports = Agent;
