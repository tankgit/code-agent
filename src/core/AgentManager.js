const ThinkingAgent = require('./agents/ThinkingAgent');
const ContextSelectionAgent = require('./agents/ContextSelectionAgent');
const PlanningAgent = require('./agents/PlanningAgent');
const ReflectionAgent = require('./agents/ReflectionAgent');
const InteractionAgent = require('./agents/InteractionAgent');
const ContextCompressionAgent = require('./agents/ContextCompressionAgent');

/**
 * Agent管理器：协调各个Agent的工作
 */
class AgentManager {
  constructor(settings, workDirectory, tools) {
    this.settings = settings;
    this.workDirectory = workDirectory;
    this.tools = tools;
    
    // 初始化各个Agent，传递workDirectory
    this.thinkingAgent = new ThinkingAgent(settings, workDirectory);
    this.contextSelectionAgent = new ContextSelectionAgent(settings, workDirectory);
    this.planningAgent = new PlanningAgent(settings, workDirectory);
    this.reflectionAgent = new ReflectionAgent(settings, workDirectory);
    this.interactionAgent = new InteractionAgent(settings, workDirectory);
    this.compressionAgent = new ContextCompressionAgent(settings, workDirectory);
  }

  /**
   * 清理消息内容中的工具调用结果JSON
   * 从AI回复中移除工具调用结果的JSON表示，避免在保存和显示时出现重复内容
   */
  cleanContentFromToolResults(content, toolCalls) {
    if (!toolCalls || !Array.isArray(toolCalls) || toolCalls.length === 0) {
      return content;
    }
    
    let cleanedContent = content;
    
    // 对每个工具调用，尝试移除其结果的JSON内容
    toolCalls.forEach(toolCall => {
      if (toolCall.result) {
        try {
          // 尝试移除工具结果的 JSON 格式内容
          const resultStr = JSON.stringify(toolCall.result);
          // 移除完全匹配的 JSON 字符串（包括可能的转义）
          const escapedResult = resultStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          cleanedContent = cleanedContent.replace(new RegExp(escapedResult, 'g'), '');
          
          // 移除格式化后的 JSON（多行，带缩进）
          const formattedResult = JSON.stringify(toolCall.result, null, 2);
          const escapedFormatted = formattedResult.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          cleanedContent = cleanedContent.replace(new RegExp(escapedFormatted, 'g'), '');
          
          // 如果结果包含 content 字段，尝试移除可能被展示的大段内容
          if (toolCall.result.content && typeof toolCall.result.content === 'string') {
            // 移除可能被直接展示的文件内容（如果内容很长）
            if (toolCall.result.content.length > 100) {
              const contentRegex = new RegExp(
                toolCall.result.content.substring(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*',
                's'
              );
              cleanedContent = cleanedContent.replace(contentRegex, '');
            }
          }
        } catch (e) {
          // 忽略解析错误
          console.warn('[AgentManager] Failed to clean tool result from content:', e);
        }
      }
    });
    
    // 清理多余的空白行和空行
    cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n').trim();
    // 移除可能残留的 JSON 标记
    cleanedContent = cleanedContent.replace(/^[\s\n]*[{\[][\s\n]*[}\]][\s\n]*$/gm, '');
    
    return cleanedContent;
  }

  /**
   * 处理用户消息的主流程
   */
  async *processMessage(userQuery, context, messageHistory, onToolCall) {
    console.log('[AgentManager] processMessage started', { userQuery, hasContext: !!context, hasHistory: !!messageHistory });
    
    // 1. 思考阶段（流式）
    console.log('[AgentManager] Starting thinking phase');
    yield { type: 'thinking', status: 'start' };
    let thinkingResult = '';
    let thinkingChunks = 0;
    for await (const delta of this.thinkingAgent.thinkStream(userQuery)) {
      thinkingChunks++;
      thinkingResult += delta;
      yield { type: 'thinking', status: 'update', content: delta };
    }
    console.log('[AgentManager] Thinking phase completed', { resultLength: thinkingResult ? thinkingResult.length : 0, chunks: thinkingChunks });
    yield { type: 'thinking', status: 'complete' };

    // 2. Context选择阶段
    const contextSelectionStartTime = new Date().toISOString();
    console.log('\n[AgentManager] ============================================================');
    console.log(`[AgentManager] [${contextSelectionStartTime}] 开始Context选择阶段`);
    console.log('[AgentManager] ============================================================');
    yield { type: 'context_selection', status: 'start' };
    const allContexts = context.getAllContexts();
    console.log(`[AgentManager] 从Context管理器获取到 ${allContexts ? allContexts.length : 0} 个可用Context`);
    if (allContexts && allContexts.length > 0) {
      console.log(`[AgentManager] Context列表:`, allContexts.map(ctx => `[${ctx.type}] ${ctx.name}`).join(', '));
    }
    console.log(`[AgentManager] 调用ContextSelectionAgent.selectContexts...`);
    const selectedContexts = await this.contextSelectionAgent.selectContexts(
      userQuery,
      thinkingResult,
      'InteractionAgent',
      allContexts
    );
    const contextSelectionEndTime = new Date().toISOString();
    console.log('[AgentManager] ============================================================');
    console.log(`[AgentManager] [${contextSelectionEndTime}] Context选择阶段完成`);
    console.log(`[AgentManager] 最终选择了 ${selectedContexts ? selectedContexts.length : 0} 个Context`);
    if (selectedContexts && selectedContexts.length > 0) {
      console.log(`[AgentManager] 选择的Context:`, selectedContexts.map(ctx => `[${ctx.type}] ${ctx.name}`).join(', '));
    }
    console.log('[AgentManager] ============================================================\n');
    yield { type: 'context_selection', status: 'complete', contexts: selectedContexts };

    // 3. 规划阶段
    console.log('[AgentManager] Starting planning phase');
    yield { type: 'planning', status: 'start' };
    const todos = await this.planningAgent.plan(userQuery, thinkingResult, selectedContexts);
    console.log('[AgentManager] Planning phase completed', { todosCount: todos ? todos.length : 0, todos });
    yield { type: 'planning', status: 'complete', todos: todos };

    // 4. 执行阶段
    console.log('[AgentManager] Starting execution phase', { todosCount: todos ? todos.length : 0 });
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i];
      console.log('[AgentManager] Starting TODO', { index: i + 1, total: todos.length, todo });
      yield { type: 'todo_start', todo: todo };
      
      // 执行交互
      let executionResult = { success: false, output: '' };
      let fullOutput = '';
      let interactionChunkCount = 0;
      let interactionContentChunks = 0;
      const todoToolCalls = []; // 收集当前TODO的工具调用

      const interactionQuery = `TODO: ${todo.title}\n描述: ${todo.description}\n用户原始需求: ${userQuery}`;
      console.log('[AgentManager] Calling interactionAgent.interact', { interactionQuery });
      
      // 获取当前轮次的消息（从最近一次用户消息开始，包括之前已完成的所有TODO的assistant回复和工具调用结果）
      // 确保当前轮次的所有消息都作为messages传递，而不是放在context里让context选择Agent来选择
      const historyMessages = messageHistory.getCurrentTurnMessages(false);
      console.log('[AgentManager] Current turn messages prepared', { 
        historyMessagesCount: historyMessages ? historyMessages.length : 0,
        messages: historyMessages.map(m => ({ role: m.role, contentLength: m.content?.length || 0, hasToolCalls: !!m.tool_calls }))
      });
      
      // 传递任务进度信息
      const taskProgress = {
        currentTaskIndex: i + 1,
        totalTasks: todos.length
      };
      
      for await (const chunk of this.interactionAgent.interact(
        interactionQuery,
        selectedContexts,
        this.tools,
        onToolCall,
        historyMessages,
        taskProgress
      )) {
        interactionChunkCount++;
        console.log('[AgentManager] Interaction chunk received', { 
          chunkNumber: interactionChunkCount, 
          type: chunk.type,
          hasContent: !!chunk.content,
          contentLength: chunk.content ? chunk.content.length : 0
        });
        
        if (chunk.type === 'content') {
          interactionContentChunks++;
          fullOutput += chunk.content;
          console.log('[AgentManager] Yielding content chunk', { 
            chunkLength: chunk.content.length, 
            totalOutputLength: fullOutput.length 
          });
          yield { type: 'content', content: chunk.content };
        } else if (chunk.type === 'tool_call_start') {
          console.log('[AgentManager] Yielding tool_call_start', { toolCall: chunk.toolCall });
          todoToolCalls.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: chunk.toolCall.arguments,
            result: null
          });
          yield chunk;
        } else if (chunk.type === 'tool_call_result') {
          console.log('[AgentManager] Yielding tool_call_result', { toolCallId: chunk.toolCallId });
          yield chunk;
          executionResult.toolCalls = executionResult.toolCalls || [];
          executionResult.toolCalls.push({
            id: chunk.toolCallId,
            result: chunk.result
          });
          // 更新工具调用结果
          const toolCall = todoToolCalls.find(tc => tc.id === chunk.toolCallId);
          if (toolCall) {
            toolCall.result = chunk.result;
          }
        } else if (chunk.type === 'tool_call_error') {
          console.log('[AgentManager] Yielding tool_call_error', { toolCallId: chunk.toolCallId, error: chunk.error });
          yield chunk;
          // 工具调用错误也作为结果添加到历史中（错误信息）
          const toolCall = todoToolCalls.find(tc => tc.id === chunk.toolCallId);
          if (toolCall) {
            toolCall.result = { error: chunk.error };
          }
        }
      }

      console.log('[AgentManager] Interaction completed', { 
        totalChunks: interactionChunkCount,
        contentChunks: interactionContentChunks,
        fullOutputLength: fullOutput.length,
        toolCallsCount: todoToolCalls.length
      });

      executionResult.output = fullOutput;
      executionResult.success = true;
      
      // 将assistant回复添加到历史（使用占位符），如果有工具调用也一并保存
      if (fullOutput || todoToolCalls.length > 0) {
        // 清理内容中的工具调用结果JSON，避免保存和显示时出现重复内容
        const cleanedOutput = this.cleanContentFromToolResults(fullOutput, todoToolCalls);
        console.log('[AgentManager] Adding assistant message to history', { 
          originalLength: fullOutput.length,
          cleanedLength: cleanedOutput.length,
          toolCallsCount: todoToolCalls.length 
        });
        messageHistory.addMessage('assistant', cleanedOutput, todoToolCalls.length > 0 ? todoToolCalls : null);
        
        // 添加工具调用结果到消息历史（每个工具调用需要一个tool角色的消息）
        if (todoToolCalls.length > 0) {
          for (const toolCall of todoToolCalls) {
            if (toolCall.result !== null && toolCall.result !== undefined) {
              messageHistory.addToolResultMessage(toolCall.id, toolCall.result);
            }
          }
        }
      } else {
        console.warn('[AgentManager] No output to add to history!');
      }

      // 5. 反思阶段
      console.log('[AgentManager] Starting reflection phase');
      yield { type: 'reflection', status: 'start', todo: todo };
      const reflection = await this.reflectionAgent.reflect(
        todo,
        executionResult,
        userQuery,
        todos,
        context.getMemoPool()
      );
      console.log('[AgentManager] Reflection completed', { type: reflection.type, reason: reflection.reason });
      // 添加todoTitle到reflection中
      reflection.todoTitle = todo.title;
      yield { type: 'reflection', status: 'complete', reflection: reflection };

      // 根据反思结果决定下一步
      if (reflection.type === 'SUCCESS') {
        console.log('[AgentManager] Reflection: SUCCESS, completing TODO');
        yield { type: 'todo_complete', todo: todo };
        // 提取备忘
        const memo = await this.compressionAgent.extractMemo(fullOutput, context.getAllContexts());
        if (memo) {
          console.log('[AgentManager] Memo extracted', { memo });
          context.addMemo(memo);
          yield { type: 'memo_added', memo: memo };
        } else {
          console.log('[AgentManager] No memo extracted');
        }
      } else if (reflection.type === 'RETRY') {
        console.log('[AgentManager] Reflection: RETRY', { reason: reflection.reason });
        yield { type: 'todo_retry', todo: todo, reason: reflection.reason };
        // 重新执行
        // TODO: 实现重试逻辑
      } else if (reflection.type === 'REPLAN') {
        console.log('[AgentManager] Reflection: REPLAN', { reason: reflection.reason });
        yield { type: 'replan_required', reason: reflection.reason };
        // 需要重新规划
        break;
      }
    }

    // 所有TODO任务完成后，主动调用一次交互Agent进行总结
    if (todos && todos.length > 0) {
      console.log('[AgentManager] All TODOs completed, calling interactionAgent for final summary');
      yield { type: 'summary', status: 'start' };
      
      let summaryOutput = '';
      const summaryQuery = `所有TODO任务已完成。请根据用户原始需求 "${userQuery}" 以及所有任务的执行结果，进行最终总结和回答。`;
      const summaryToolCalls = []; // 收集总结阶段的工具调用
      
      // 获取当前轮次的所有消息（包括所有已完成的任务的交互历史）
      const historyMessages = messageHistory.getCurrentTurnMessages(false);
      console.log('[AgentManager] Summary - Current turn messages prepared', { 
        historyMessagesCount: historyMessages ? historyMessages.length : 0
      });
      
      // 不传递任务进度信息（因为所有任务已完成）
      for await (const chunk of this.interactionAgent.interact(
        summaryQuery,
        selectedContexts,
        this.tools,
        onToolCall,
        historyMessages,
        null // 不传递任务进度，因为这是总结阶段
      )) {
        if (chunk.type === 'content') {
          summaryOutput += chunk.content;
          yield { type: 'content', content: chunk.content };
        } else if (chunk.type === 'tool_call_start') {
          summaryToolCalls.push({
            id: chunk.toolCall.id,
            name: chunk.toolCall.name,
            arguments: chunk.toolCall.arguments,
            result: null
          });
          yield chunk;
        } else if (chunk.type === 'tool_call_result') {
          yield chunk;
          const toolCall = summaryToolCalls.find(tc => tc.id === chunk.toolCallId);
          if (toolCall) {
            toolCall.result = chunk.result;
          }
        } else if (chunk.type === 'tool_call_error') {
          yield chunk;
          const toolCall = summaryToolCalls.find(tc => tc.id === chunk.toolCallId);
          if (toolCall) {
            toolCall.result = { error: chunk.error };
          }
        }
      }
      
      // 将总结添加到消息历史（包括工具调用）
      if (summaryOutput || summaryToolCalls.length > 0) {
        // 清理内容中的工具调用结果JSON，避免保存和显示时出现重复内容
        const cleanedSummaryOutput = this.cleanContentFromToolResults(summaryOutput, summaryToolCalls);
        console.log('[AgentManager] Adding summary message to history', { 
          originalLength: summaryOutput.length,
          cleanedLength: cleanedSummaryOutput.length,
          toolCallsCount: summaryToolCalls.length
        });
        messageHistory.addMessage('assistant', cleanedSummaryOutput, summaryToolCalls.length > 0 ? summaryToolCalls : null);
        
        // 添加工具调用结果到消息历史
        if (summaryToolCalls.length > 0) {
          for (const toolCall of summaryToolCalls) {
            if (toolCall.result !== null && toolCall.result !== undefined) {
              messageHistory.addToolResultMessage(toolCall.id, toolCall.result);
            }
          }
        }
      }
      
      yield { type: 'summary', status: 'complete' };
    }

    console.log('[AgentManager] processMessage completed');
    yield { type: 'complete' };
  }

  /**
   * 压缩会话历史
   */
  async compressHistory(messages) {
    return await this.compressionAgent.compressMessages(messages);
  }
}

module.exports = AgentManager;
