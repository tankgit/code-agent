const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');
const { URL } = require('url');

/**
 * 编码代理 URL，确保用户名和密码中的特殊字符被正确转义
 * @param {string} proxyUrl - 代理 URL，格式：http://username:password@proxy_address:port
 * @returns {string} - 编码后的代理 URL
 */
function encodeProxyUrl(proxyUrl) {
  if (!proxyUrl) return proxyUrl;
  
  try {
    // 尝试使用 URL 对象解析（如果 URL 格式正确）
    const url = new URL(proxyUrl);
    
    // 如果 URL 中已经包含用户名和密码，对它们进行编码
    if (url.username || url.password) {
      // 先尝试解码（如果已经编码），然后重新编码以确保正确性
      let username = url.username || '';
      let password = url.password || '';
      
      try {
        // 尝试解码，如果失败说明未编码，直接编码
        username = decodeURIComponent(username);
        password = decodeURIComponent(password);
      } catch (e) {
        // 解码失败，说明可能包含特殊字符但未编码，直接使用
      }
      
      // 对用户名和密码进行编码
      const encodedUsername = encodeURIComponent(username);
      const encodedPassword = encodeURIComponent(password);
      
      // 重新构建 URL
      url.username = encodedUsername;
      url.password = encodedPassword;
      return url.toString();
    }
    
    // 如果没有用户名和密码，直接返回
    return proxyUrl;
  } catch (error) {
    // 如果 URL 解析失败（可能因为特殊字符），尝试手动处理
    // 匹配格式：protocol://username:password@host:port
    const match = proxyUrl.match(/^([^:]+):\/\/(?:([^:@]+):([^@]+)@)?([^:]+)(?::(\d+))?/);
    if (match) {
      const [, protocol, username, password, host, port] = match;
      if (username && password) {
        // 对用户名和密码进行编码
        const encodedUsername = encodeURIComponent(username);
        const encodedPassword = encodeURIComponent(password);
        const portPart = port ? `:${port}` : '';
        return `${protocol}://${encodedUsername}:${encodedPassword}@${host}${portPart}`;
      }
    }
    
    // 如果无法解析，返回原 URL（让代理库处理）
    console.warn('Failed to parse proxy URL, using as-is:', proxyUrl);
    return proxyUrl;
  }
}

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
   * 解析代理 URL 为配置对象
   * @param {string} proxyUrl - 代理 URL
   * @returns {object|null} - 代理配置对象 { host, port, auth } 或 null
   */
  parseProxyConfig(proxyUrl) {
    if (!proxyUrl) return null;
    
    let username = '';
    let password = '';
    let host = '';
    let port = 0;
    
    try {
      const url = new URL(proxyUrl);
      host = url.hostname;
      port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
      
      // 如果有用户名或密码，添加到配置中
      if (url.username || url.password) {
        username = url.username || '';
        password = url.password || '';
        
        // 尝试解码（如果已编码）
        try {
          if (username) username = decodeURIComponent(username);
          if (password) password = decodeURIComponent(password);
        } catch (e) {
          // 解码失败，使用原值
        }
      }
      
      const config = {
        host: host,
        port: port
      };
      
      if (username || password) {
        config.auth = `${username}:${password}`;
      }
      
      // 记录详细的代理配置信息（包含明文密码，用于调试）
      console.log(`[${this.name}] Proxy Config Parsed:`, JSON.stringify({
        originalUrl: proxyUrl,
        host: host,
        port: port,
        username: username,
        password: password, // 明文密码，用于调试
        hasAuth: !!(username || password)
      }, null, 2));
      
      return config;
    } catch (error) {
      // 如果 URL 解析失败，尝试正则匹配
      const match = proxyUrl.match(/^([^:]+):\/\/(?:([^:@]+):([^@]+)@)?([^:]+)(?::(\d+))?/);
      if (match) {
        const [, protocol, matchedUsername, matchedPassword, matchedHost, matchedPort] = match;
        host = matchedHost;
        port = matchedPort ? parseInt(matchedPort) : (protocol === 'https:' ? 443 : 80);
        
        if (matchedUsername && matchedPassword) {
          username = matchedUsername;
          password = matchedPassword;
          
          try {
            username = decodeURIComponent(matchedUsername);
            password = decodeURIComponent(matchedPassword);
          } catch (e) {
            // 解码失败，使用原值
          }
        }
        
        const config = {
          host: host,
          port: port
        };
        
        if (username || password) {
          config.auth = `${username}:${password}`;
        }
        
        // 记录详细的代理配置信息（包含明文密码，用于调试）
        console.log(`[${this.name}] Proxy Config Parsed (regex):`, JSON.stringify({
          originalUrl: proxyUrl,
          host: host,
          port: port,
          username: username,
          password: password, // 明文密码，用于调试
          hasAuth: !!(username || password)
        }, null, 2));
        
        return config;
      }
      
      console.warn(`[${this.name}] Failed to parse proxy URL:`, proxyUrl);
      return null;
    }
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

    // 配置代理 - 使用配置对象方式，更兼容各种代理服务器
    // 判断 API URL 是 HTTP 还是 HTTPS
    const isHttps = this.settings.apiUrl && this.settings.apiUrl.startsWith('https://');
    
    // 记录代理配置详情（包含明文密码，用于调试）
    console.log(`[${this.name}] Proxy Configuration Check:`, JSON.stringify({
      apiUrl: this.settings.apiUrl,
      isHttps: isHttps,
      httpProxy: this.settings.httpProxy || '(not set)',
      httpsProxy: this.settings.httpsProxy || '(not set)'
    }, null, 2));
    
    if (isHttps && this.settings.httpsProxy) {
      // HTTPS 请求使用 httpsProxy
      const proxyConfig = this.parseProxyConfig(this.settings.httpsProxy);
      if (proxyConfig) {
        config.httpsAgent = new HttpsProxyAgent(proxyConfig);
        // 记录最终使用的代理配置（包含明文密码，用于调试）
        const authParts = proxyConfig.auth ? proxyConfig.auth.split(':') : [];
        console.log(`[${this.name}] HTTPS Agent Created:`, JSON.stringify({
          type: 'HttpsProxyAgent',
          host: proxyConfig.host,
          port: proxyConfig.port,
          username: authParts[0] || '',
          password: authParts[1] || '', // 明文密码，用于调试
          authString: proxyConfig.auth || '(no auth)',
          configObject: proxyConfig
        }, null, 2));
      }
    } else if (isHttps && this.settings.httpProxy) {
      // HTTPS 请求但只配置了 httpProxy，也使用它
      const proxyConfig = this.parseProxyConfig(this.settings.httpProxy);
      if (proxyConfig) {
        config.httpsAgent = new HttpsProxyAgent(proxyConfig);
        // 记录最终使用的代理配置（包含明文密码，用于调试）
        const authParts = proxyConfig.auth ? proxyConfig.auth.split(':') : [];
        console.log(`[${this.name}] HTTPS Agent Created (using HTTP proxy):`, JSON.stringify({
          type: 'HttpsProxyAgent',
          host: proxyConfig.host,
          port: proxyConfig.port,
          username: authParts[0] || '',
          password: authParts[1] || '', // 明文密码，用于调试
          authString: proxyConfig.auth || '(no auth)',
          configObject: proxyConfig
        }, null, 2));
      }
    } else if (!isHttps && this.settings.httpProxy) {
      // HTTP 请求使用 httpProxy
      const proxyConfig = this.parseProxyConfig(this.settings.httpProxy);
      if (proxyConfig) {
        config.httpAgent = new HttpProxyAgent(proxyConfig);
        // 记录最终使用的代理配置（包含明文密码，用于调试）
        const authParts = proxyConfig.auth ? proxyConfig.auth.split(':') : [];
        console.log(`[${this.name}] HTTP Agent Created:`, JSON.stringify({
          type: 'HttpProxyAgent',
          host: proxyConfig.host,
          port: proxyConfig.port,
          username: authParts[0] || '',
          password: authParts[1] || '', // 明文密码，用于调试
          authString: proxyConfig.auth || '(no auth)',
          configObject: proxyConfig
        }, null, 2));
      }
    } else if (!isHttps && this.settings.httpsProxy) {
      // HTTP 请求但只配置了 httpsProxy，也使用它
      const proxyConfig = this.parseProxyConfig(this.settings.httpsProxy);
      if (proxyConfig) {
        config.httpAgent = new HttpProxyAgent(proxyConfig);
        // 记录最终使用的代理配置（包含明文密码，用于调试）
        const authParts = proxyConfig.auth ? proxyConfig.auth.split(':') : [];
        console.log(`[${this.name}] HTTP Agent Created (using HTTPS proxy):`, JSON.stringify({
          type: 'HttpProxyAgent',
          host: proxyConfig.host,
          port: proxyConfig.port,
          username: authParts[0] || '',
          password: authParts[1] || '', // 明文密码，用于调试
          authString: proxyConfig.auth || '(no auth)',
          configObject: proxyConfig
        }, null, 2));
      }
    } else {
      console.log(`[${this.name}] No proxy configured`);
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
