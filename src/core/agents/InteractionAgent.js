const Agent = require('../Agent');
const promptLoader = require('../PromptLoader');

/**
 * 交互Agent：实际执行工具调用和与用户对话的Agent
 */
class InteractionAgent extends Agent {
  constructor(settings, workDirectory) {
    super(settings, workDirectory);
    this.name = 'InteractionAgent';
  }

  getSystemPrompt(selectedContexts) {
    const contextInfo = selectedContexts.map(ctx => 
      `${ctx.name}: ${JSON.stringify(ctx.content).substring(0, 500)}`
    ).join('\n\n');

    const basePrompt = promptLoader.load('InteractionAgent', {
      CONTEXTS: contextInfo || '无'
    });
    
    const workDirInfo = this.workDirectory 
      ? `\n\n重要提示：当前工作目录路径为：${this.workDirectory}\n所有文件操作和路径引用都应该基于此工作目录。`
      : '\n\n重要提示：工作目录未设置。';
    
    return basePrompt + workDirInfo;
  }

  async *interact(userQuery, selectedContexts, tools, onToolCall, historyMessages = [], taskProgress = null) {
    console.log('[InteractionAgent] interact started', { 
      userQuery, 
      selectedContextsCount: selectedContexts ? selectedContexts.length : 0,
      toolsCount: tools ? tools.length : 0,
      hasOnToolCall: !!onToolCall,
      historyMessagesCount: historyMessages ? historyMessages.length : 0,
      taskProgress
    });
    
    // 如果提供了任务进度信息，添加到userQuery中
    let finalUserQuery = userQuery;
    if (taskProgress && taskProgress.currentTaskIndex !== undefined && taskProgress.totalTasks !== undefined) {
      finalUserQuery = `【任务进度】当前执行第 ${taskProgress.currentTaskIndex} 个任务，共 ${taskProgress.totalTasks} 个任务\n\n${userQuery}`;
    }
    
    const systemPrompt = this.getSystemPrompt(selectedContexts);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...(historyMessages || []), // 添加历史对话消息（可能已经被context压缩或选择Agent精简过）
      { role: 'user', content: finalUserQuery }
    ];
    console.log('[InteractionAgent] Messages prepared', { 
      systemPromptLength: systemPrompt.length,
      userQueryLength: userQuery.length,
      historyMessagesCount: historyMessages ? historyMessages.length : 0,
      totalMessagesCount: messages.length
    });

    // 确保只使用传入的工具列表（应该已经是过滤后的）
    const toolDefinitions = (tools || []).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      }
    }));
    console.log('[InteractionAgent] Tool definitions prepared', { 
      toolsCount: toolDefinitions.length, 
      toolNames: (tools || []).map(t => t.name),
      toolDisplayNames: (tools || []).map(t => t.displayName)
    });
    
    // 如果没有工具，记录警告
    if (toolDefinitions.length === 0) {
      console.warn('[InteractionAgent] No tools available for interaction');
    }

    let fullContent = '';
    const toolCallsMap = new Map(); // 使用Map存储增量工具调用
    const toolCallsYielded = new Set(); // 记录已经yield过的工具调用index
    let streamChunkCount = 0;
    let contentChunkCount = 0;
    let toolCallChunkCount = 0;

    console.log('[InteractionAgent] Starting streamChat');
    for await (const chunk of this.streamChat(messages, toolDefinitions)) {
      streamChunkCount++;
      
      if (typeof chunk === 'string') {
        contentChunkCount++;
        fullContent += chunk;
        console.log('[InteractionAgent] Content chunk received', { 
          chunkNumber: streamChunkCount,
          contentChunkNumber: contentChunkCount,
          chunkLength: chunk.length, 
          totalContentLength: fullContent.length 
        });
        yield { type: 'content', content: chunk };
      } else if (chunk.tool_calls) {
        toolCallChunkCount++;
        console.log('[InteractionAgent] Tool call chunk received', { 
          chunkNumber: streamChunkCount,
          toolCallChunkNumber: toolCallChunkCount,
          toolCallsCount: chunk.tool_calls ? chunk.tool_calls.length : 0 
        });
        // 处理工具调用的增量更新
        for (const toolCallDelta of chunk.tool_calls) {
          if (toolCallDelta.index !== undefined) {
            const index = toolCallDelta.index;
            if (!toolCallsMap.has(index)) {
              toolCallsMap.set(index, {
                id: toolCallDelta.id || `call_${index}_${Date.now()}`,
                type: 'function',
                function: {
                  name: '',
                  arguments: ''
                }
              });
              console.log('[InteractionAgent] New tool call started', { index, id: toolCallsMap.get(index).id });
            }
            const toolCall = toolCallsMap.get(index);
            if (toolCallDelta.function) {
              if (toolCallDelta.function.name) {
                toolCall.function.name += toolCallDelta.function.name;
                console.log('[InteractionAgent] Tool call name updated', { index, name: toolCall.function.name });
              }
              if (toolCallDelta.function.arguments) {
                toolCall.function.arguments += toolCallDelta.function.arguments;
                console.log('[InteractionAgent] Tool call arguments updated', { index, argsLength: toolCall.function.arguments.length });
              }
            }
            
            // 如果工具名称已经获得且还没有yield过，尝试yield tool_call_start
            // 但只有在参数至少有一些内容（不是空字符串）时才yield，避免显示空参数
            if (toolCall.function.name && !toolCallsYielded.has(index)) {
              // 尝试解析参数（可能不完整）
              let args = {};
              let hasValidArgs = false;
              try {
                if (toolCall.function.arguments && toolCall.function.arguments.trim().length > 0) {
                  // 尝试解析，如果失败说明参数还不完整
                  args = JSON.parse(toolCall.function.arguments);
                  // 检查是否是有效的非空对象
                  if (args && typeof args === 'object' && Object.keys(args).length > 0) {
                    hasValidArgs = true;
                  }
                }
              } catch (e) {
                // 参数可能不完整，暂时不yield，等待更多数据
                // console.log('[InteractionAgent] Arguments not complete yet, waiting...', { toolCallId: toolCall.id });
              }
              
              // 只有在参数有效时才yield tool_call_start
              // 如果参数还不完整，会在流式传输完成后通过tool_call_update更新
              if (hasValidArgs) {
                toolCallsYielded.add(index);
                // 从工具实例中获取 displayName
                const toolInstance = tools.find(t => t.name === toolCall.function.name);
                const displayName = toolInstance ? toolInstance.displayName : toolCall.function.name;
                
                console.log('[InteractionAgent] Yielding tool_call_start with valid arguments', { toolCallId: toolCall.id, toolName: toolCall.function.name, displayName, args });
                yield { 
                  type: 'tool_call_start', 
                  toolCall: {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    displayName: displayName,
                    arguments: args
                  }
                };
              }
            }
          }
        }
      } else {
        console.log('[InteractionAgent] Unknown chunk type', { chunkNumber: streamChunkCount, chunkType: typeof chunk });
      }
    }

    console.log('[InteractionAgent] StreamChat completed', { 
      totalChunks: streamChunkCount,
      contentChunks: contentChunkCount,
      toolCallChunks: toolCallChunkCount,
      totalContentLength: fullContent.length,
      toolCallsMapSize: toolCallsMap.size
    });

    // 处理完整的工具调用（执行工具调用并返回结果）
    // 注意：tool_call_start已经在流式输出过程中yield过了，这里需要更新完整的参数信息
    const toolCalls = Array.from(toolCallsMap.values());
    console.log('[InteractionAgent] Processing tool calls', { toolCallsCount: toolCalls.length, yieldedCount: toolCallsYielded.size });
    
    if (toolCalls.length > 0) {
      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const index = Array.from(toolCallsMap.keys())[i];
        console.log('[InteractionAgent] Processing tool call', { index: i + 1, total: toolCalls.length, toolCall });
        
        // 即使工具调用有问题，也要显示出来，让用户知道发生了什么
        // 确保toolCall.id存在，如果不存在则生成一个
        if (!toolCall.id) {
          toolCall.id = `call_${index}_${Date.now()}`;
          console.warn('[InteractionAgent] Tool call missing ID, generated one', { toolCallId: toolCall.id, index });
        }
        
        const toolName = toolCall.function.name || 'unknown_tool';
        let args = {};
        let parseError = null;
        
        // 尝试解析参数
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
          console.log('[InteractionAgent] Parsed tool arguments (complete)', { toolName, args, argsKeys: Object.keys(args || {}) });
        } catch (e) {
          parseError = e;
          console.error('[InteractionAgent] Failed to parse tool arguments', { toolName, error: e.message, rawArgs: toolCall.function.arguments });
          // 即使解析失败，也使用原始参数字符串作为参数显示
          args = { _raw_arguments: toolCall.function.arguments || '', _parse_error: e.message };
        }
        
        // 从工具实例中获取 displayName
        const toolInstance = tools.find(t => t.name === toolName);
        const displayName = toolInstance ? toolInstance.displayName : toolName;
        
        // 如果工具调用还没有被yield过（可能在流式输出过程中没有获得名称或参数不完整），现在yield tool_call_start
        if (!toolCallsYielded.has(index)) {
          console.log('[InteractionAgent] Yielding tool_call_start (complete arguments)', { toolCallId: toolCall.id, toolName, displayName, args, hasParseError: !!parseError });
          yield { 
            type: 'tool_call_start', 
            toolCall: {
              id: toolCall.id,
              name: toolName,
              displayName: displayName,
              arguments: args
            }
          };
          toolCallsYielded.add(index);
        } else {
          // 如果已经yield过，现在yield一个更新事件，包含完整的参数信息
          // 这确保即使流式传输过程中参数不完整，流式传输完成后也会用完整参数更新
          console.log('[InteractionAgent] Yielding tool_call_update with complete arguments', { toolCallId: toolCall.id, toolName, displayName, args, hasParseError: !!parseError });
          yield { 
            type: 'tool_call_update', 
            toolCall: {
              id: toolCall.id,
              name: toolName,
              displayName: displayName,
              arguments: args
            }
          };
        }

        // 如果参数解析失败，直接yield错误，不执行工具调用
        if (parseError) {
          console.error('[InteractionAgent] Tool call skipped due to parse error', { toolName, error: parseError.message });
          yield { 
            type: 'tool_call_error', 
            toolCallId: toolCall.id,
            error: `参数解析失败: ${parseError.message}。原始参数: ${toolCall.function.arguments || '空'}`
          };
        } else if (!toolName || toolName === 'unknown_tool') {
          // 如果工具名称缺失，也yield错误
          console.error('[InteractionAgent] Tool call skipped due to missing tool name', { toolCall });
          yield { 
            type: 'tool_call_error', 
            toolCallId: toolCall.id,
            error: '工具名称缺失，无法执行工具调用'
          };
        } else if (onToolCall) {
          // 参数解析成功且工具名称存在，执行工具调用
          try {
            console.log('[InteractionAgent] Calling onToolCall', { toolName, args });
            const result = await onToolCall(toolName, args);
            console.log('[InteractionAgent] onToolCall completed', { toolName, resultLength: JSON.stringify(result).length });
            yield { 
              type: 'tool_call_result', 
              toolCallId: toolCall.id,
              result: result
            };
          } catch (error) {
            console.error('[InteractionAgent] onToolCall error', { toolName, error: error.message });
            yield { 
              type: 'tool_call_error', 
              toolCallId: toolCall.id,
              error: error.message
            };
          }
        } else {
          console.warn('[InteractionAgent] onToolCall is not provided');
          yield { 
            type: 'tool_call_error', 
            toolCallId: toolCall.id,
            error: '工具调用处理器未提供'
          };
        }
      }
    } else {
      console.log('[InteractionAgent] No tool calls to process');
    }
    
    console.log('[InteractionAgent] interact completed', { totalContentLength: fullContent.length });
  }
}

module.exports = InteractionAgent;
