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

    const toolDefinitions = tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.schema
      }
    }));
    console.log('[InteractionAgent] Tool definitions prepared', { toolsCount: toolDefinitions.length, toolNames: tools.map(t => t.name) });

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
            
            // 如果工具名称已经获得且还没有yield过，立即yield tool_call_start
            if (toolCall.function.name && !toolCallsYielded.has(index)) {
              toolCallsYielded.add(index);
              // 尝试解析参数（可能不完整）
              let args = {};
              try {
                if (toolCall.function.arguments) {
                  args = JSON.parse(toolCall.function.arguments || '{}');
                }
              } catch (e) {
                // 参数可能不完整，使用空对象
                args = {};
              }
              
              console.log('[InteractionAgent] Yielding tool_call_start immediately', { toolCallId: toolCall.id, toolName: toolCall.function.name, args });
              yield { 
                type: 'tool_call_start', 
                toolCall: {
                  id: toolCall.id,
                  name: toolCall.function.name,
                  arguments: args
                }
              };
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
    // 注意：tool_call_start已经在流式输出过程中yield过了，这里只执行工具调用并返回结果
    const toolCalls = Array.from(toolCallsMap.values());
    console.log('[InteractionAgent] Processing tool calls', { toolCallsCount: toolCalls.length, yieldedCount: toolCallsYielded.size });
    
    if (toolCalls.length > 0) {
      for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const index = Array.from(toolCallsMap.keys())[i];
        console.log('[InteractionAgent] Processing tool call', { index: i + 1, total: toolCalls.length, toolCall });
        
        if (!toolCall.function.name) {
          console.warn('[InteractionAgent] Tool call has no name, skipping', { toolCall });
          continue;
        }
        
        const toolName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
          console.log('[InteractionAgent] Parsed tool arguments', { toolName, args });
        } catch (e) {
          console.error('[InteractionAgent] Failed to parse tool arguments', { toolName, error: e.message, rawArgs: toolCall.function.arguments });
          continue;
        }
        
        // 如果工具调用还没有被yield过（可能在流式输出过程中没有获得名称），现在yield
        if (!toolCallsYielded.has(index)) {
          console.log('[InteractionAgent] Yielding tool_call_start (missed during stream)', { toolCallId: toolCall.id, toolName, args });
          yield { 
            type: 'tool_call_start', 
            toolCall: {
              id: toolCall.id,
              name: toolName,
              arguments: args
            }
          };
          toolCallsYielded.add(index);
        }

        if (onToolCall) {
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
        }
      }
    } else {
      console.log('[InteractionAgent] No tool calls to process');
    }
    
    console.log('[InteractionAgent] interact completed', { totalContentLength: fullContent.length });
  }
}

module.exports = InteractionAgent;
