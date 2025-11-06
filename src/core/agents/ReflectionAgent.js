const Agent = require('../Agent');
const promptLoader = require('../PromptLoader');

/**
 * 反思Agent：在TODO任务执行后，进行反思判断
 */
class ReflectionAgent extends Agent {
  constructor(settings, workDirectory) {
    super(settings, workDirectory);
    this.name = 'ReflectionAgent';
  }

  getSystemPrompt() {
    const basePrompt = promptLoader.load('ReflectionAgent');
    const workDirInfo = this.workDirectory 
      ? `\n\n重要提示：当前工作目录路径为：${this.workDirectory}\n所有文件操作和路径引用都应该基于此工作目录。`
      : '\n\n重要提示：工作目录未设置。';
    return basePrompt + workDirInfo;
  }

  async reflect(todoItem, executionResult, userQuery, allTodos, memoPool) {
    console.log('[ReflectionAgent] reflect called', { 
      todoItem: todoItem?.title,
      executionResultSuccess: executionResult?.success,
      outputLength: executionResult?.output?.length || 0,
      allTodosCount: allTodos ? allTodos.length : 0,
      memoPoolCount: memoPool ? memoPool.length : 0
    });
    
    const memoSummary = memoPool.map(m => `${m.title}: ${m.content.substring(0, 100)}`).join('\n');

    const prompt = `用户Query: ${userQuery}

执行的TODO任务:
${JSON.stringify(todoItem, null, 2)}

执行结果:
${JSON.stringify(executionResult, null, 2)}

所有TODO列表:
${JSON.stringify(allTodos, null, 2)}

备忘池信息:
${memoSummary || '无'}

请判断执行结果，输出SUCCESS、RETRY或REPLAN。如果需要调整，请说明原因。`;

    const systemPrompt = this.getSystemPrompt();
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];
    console.log('[ReflectionAgent] Messages prepared', { 
      systemPromptLength: systemPrompt.length, 
      promptLength: prompt.length 
    });

    const result = await this.callChat(messages);
    const content = result.choices[0].message.content.trim().toUpperCase();
    console.log('[ReflectionAgent] Raw response received', { contentLength: content.length, content: content.substring(0, 200) });
    
    let reflectionType = 'SUCCESS';
    if (content.includes('RETRY')) {
      reflectionType = 'RETRY';
    } else if (content.includes('REPLAN')) {
      reflectionType = 'REPLAN';
    }

    const reflection = {
      type: reflectionType,
      reason: result.choices[0].message.content
    };
    console.log('[ReflectionAgent] reflect completed', { reflectionType, reasonLength: reflection.reason.length });
    return reflection;
  }
}

module.exports = ReflectionAgent;
