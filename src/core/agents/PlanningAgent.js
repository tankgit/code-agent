const Agent = require('../Agent');
const promptLoader = require('../PromptLoader');

/**
 * 规划Agent：基于思考结果和Context，输出TODO列表
 */
class PlanningAgent extends Agent {
  constructor(settings, workDirectory) {
    super(settings, workDirectory);
    this.name = 'PlanningAgent';
  }

  getSystemPrompt(tools = []) {
    const basePrompt = promptLoader.load('PlanningAgent');
    const workDirInfo = this.workDirectory 
      ? `\n\n重要提示：当前工作目录路径为：${this.workDirectory}\n所有文件操作和路径引用都应该基于此工作目录。`
      : '\n\n重要提示：工作目录未设置。';
    
    // 添加工具信息
    let toolsInfo = '';
    if (tools && tools.length > 0) {
      toolsInfo = '\n\n可用工具列表：\n';
      tools.forEach((tool, index) => {
        toolsInfo += `${index + 1}. ${tool.displayName} (${tool.name})\n`;
        toolsInfo += `   描述：${tool.description}\n`;
        if (tool.schema && tool.schema.properties) {
          const requiredParams = tool.schema.required || [];
          const properties = tool.schema.properties;
          toolsInfo += `   参数：\n`;
          Object.keys(properties).forEach(paramName => {
            const param = properties[paramName];
            const isRequired = requiredParams.includes(paramName);
            toolsInfo += `     - ${paramName} (${param.type || 'unknown'})${isRequired ? ' [必填]' : ' [可选]'}`;
            if (param.description) {
              toolsInfo += `: ${param.description}`;
            }
            toolsInfo += '\n';
          });
        }
        toolsInfo += '\n';
      });
    } else {
      toolsInfo = '\n\n可用工具列表：无可用工具。\n';
    }
    
    return basePrompt + workDirInfo + toolsInfo;
  }

  async plan(userQuery, thinkingResult, selectedContexts, tools = []) {
    console.log('[PlanningAgent] plan called', { 
      userQueryLength: userQuery ? userQuery.length : 0,
      thinkingResultLength: thinkingResult ? thinkingResult.length : 0,
      selectedContextsCount: selectedContexts ? selectedContexts.length : 0,
      toolsCount: tools ? tools.length : 0
    });
    
    const contextSummary = selectedContexts.map(ctx => 
      `${ctx.name} (${ctx.type}): ${JSON.stringify(ctx.content).substring(0, 200)}`
    ).join('\n');

    const prompt = `用户Query: ${userQuery}

思考结果:
${thinkingResult}

可用Context环境:
${contextSummary || '无'}

请制定详细的任务计划，输出JSON格式的TODO列表。`;

    const systemPrompt = this.getSystemPrompt(tools);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];
    console.log('[PlanningAgent] Messages prepared', { 
      systemPromptLength: systemPrompt.length, 
      promptLength: prompt.length 
    });

    const result = await this.callChat(messages);
    let content = result.choices[0].message.content.trim();
    console.log('[PlanningAgent] Raw response received', { contentLength: content.length, preview: content.substring(0, 200) });
    
    // 提取JSON部分
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      content = jsonMatch[0];
      console.log('[PlanningAgent] JSON extracted', { jsonLength: content.length });
    } else {
      console.warn('[PlanningAgent] No JSON array found in response');
    }

    try {
      const todos = JSON.parse(content);
      const todosArray = Array.isArray(todos) ? todos : [];
      console.log('[PlanningAgent] plan completed', { todosCount: todosArray.length, todos });
      return todosArray;
    } catch (e) {
      // 如果解析失败，尝试提取并修复
      console.error('[PlanningAgent] Failed to parse TODO list', { error: e.message, content: content.substring(0, 500) });
      return [];
    }
  }
}

module.exports = PlanningAgent;
