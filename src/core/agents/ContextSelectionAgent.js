const Agent = require('../Agent');
const promptLoader = require('../PromptLoader');

/**
 * Context选择Agent：为指定Agent选择需要使用的环境
 */
class ContextSelectionAgent extends Agent {
  constructor(settings, workDirectory) {
    super(settings, workDirectory);
    this.name = 'ContextSelectionAgent';
  }

  getSystemPrompt() {
    const basePrompt = promptLoader.load('ContextSelectionAgent');
    const workDirInfo = this.workDirectory 
      ? `\n\n重要提示：当前工作目录路径为：${this.workDirectory}\n所有文件操作和路径引用都应该基于此工作目录。`
      : '\n\n重要提示：工作目录未设置。';
    return basePrompt + workDirInfo;
  }

  async selectContext(userQuery, thinkingResult, targetAgent, contextItem) {
    const timestamp = new Date().toISOString();
    const contextContentStr = JSON.stringify(contextItem.content);
    const contentLength = contextContentStr.length;
    const contentPreview = contentLength > 200 
      ? contextContentStr.substring(0, 200) + '...' 
      : contextContentStr;
    
    console.log('[ContextSelectionAgent] ========================================');
    console.log(`[ContextSelectionAgent] [${timestamp}] 开始判断单个Context`);
    console.log(`[ContextSelectionAgent] Context名称: ${contextItem.name}`);
    console.log(`[ContextSelectionAgent] Context类型: ${contextItem.type}`);
    console.log(`[ContextSelectionAgent] Context内容长度: ${contentLength} 字符`);
    console.log(`[ContextSelectionAgent] Context内容预览: ${contentPreview}`);
    console.log(`[ContextSelectionAgent] 目标Agent: ${targetAgent}`);
    console.log(`[ContextSelectionAgent] 用户Query长度: ${userQuery ? userQuery.length : 0} 字符`);
    console.log(`[ContextSelectionAgent] 思考结果长度: ${thinkingResult ? thinkingResult.length : 0} 字符`);
    
    const prompt = `用户Query: ${userQuery}

思考结果: ${thinkingResult}

目标Agent: ${targetAgent}

环境信息:
名称: ${contextItem.name}
类型: ${contextItem.type}
内容: ${JSON.stringify(contextItem.content, null, 2)}

请判断是否应该使用这个环境。只输出1或0。`;

    const systemPrompt = this.getSystemPrompt();
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    const startTime = Date.now();
    const result = await this.callChat(messages);
    const endTime = Date.now();
    const duration = endTime - startTime;
    const output = result.choices[0].message.content.trim();
    
    console.log(`[ContextSelectionAgent] AI原始响应: "${output}"`);
    console.log(`[ContextSelectionAgent] 判断耗时: ${duration}ms`);
    
    // 提取数字
    const match = output.match(/\d+/);
    const shouldUse = match ? parseInt(match[0]) === 1 : false;
    
    console.log(`[ContextSelectionAgent] 判断结果: ${shouldUse ? '✓ 选择' : '✗ 不选择'} "${contextItem.name}"`);
    console.log('[ContextSelectionAgent] ========================================');
    
    return shouldUse;
  }

  async selectContexts(userQuery, thinkingResult, targetAgent, contexts) {
    const timestamp = new Date().toISOString();
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    ContextSelectionAgent 开始执行                             ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
    console.log(`[ContextSelectionAgent] [${timestamp}] 收到Context选择请求`);
    console.log(`[ContextSelectionAgent] 目标Agent: ${targetAgent}`);
    console.log(`[ContextSelectionAgent] 用户Query: ${userQuery ? (userQuery.length > 100 ? userQuery.substring(0, 100) + '...' : userQuery) : '(空)'}`);
    console.log(`[ContextSelectionAgent] 思考结果长度: ${thinkingResult ? thinkingResult.length : 0} 字符`);
    console.log(`[ContextSelectionAgent] 可用Context总数: ${contexts ? contexts.length : 0}`);
    
    if (contexts && contexts.length > 0) {
      console.log(`[ContextSelectionAgent] 可用Context列表:`);
      contexts.forEach((ctx, idx) => {
        const contentStr = JSON.stringify(ctx.content);
        const contentLength = contentStr.length;
        console.log(`[ContextSelectionAgent]   ${idx + 1}. [${ctx.type}] ${ctx.name} (${contentLength} 字符)`);
      });
    }
    
    console.log('\n[ContextSelectionAgent] 开始逐个判断Context...\n');
    
    const startTime = Date.now();
    const results = [];
    const rejectedContexts = [];
    
    for (let i = 0; i < contexts.length; i++) {
      const context = contexts[i];
      console.log(`\n[ContextSelectionAgent] ──────────────────────────────────────────────────────`);
      console.log(`[ContextSelectionAgent] 正在判断第 ${i + 1}/${contexts.length} 个Context: "${context.name}"`);
      console.log(`[ContextSelectionAgent] ──────────────────────────────────────────────────────`);
      
      const shouldUse = await this.selectContext(userQuery, thinkingResult, targetAgent, context);
      
      if (shouldUse) {
        results.push(context);
        console.log(`[ContextSelectionAgent] ✓ Context "${context.name}" 已被选择`);
      } else {
        rejectedContexts.push(context);
        console.log(`[ContextSelectionAgent] ✗ Context "${context.name}" 未选择`);
      }
    }
    
    const endTime = Date.now();
    const totalDuration = endTime - startTime;
    
    console.log('\n');
    console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                    ContextSelectionAgent 执行完成                             ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
    console.log(`[ContextSelectionAgent] 总耗时: ${totalDuration}ms`);
    console.log(`[ContextSelectionAgent] 判断总数: ${contexts.length}`);
    console.log(`[ContextSelectionAgent] 选择数量: ${results.length}`);
    console.log(`[ContextSelectionAgent] 未选择数量: ${rejectedContexts.length}`);
    
    if (results.length > 0) {
      console.log(`[ContextSelectionAgent] ✓ 已选择的Context列表:`);
      results.forEach((ctx, idx) => {
        const contentStr = JSON.stringify(ctx.content);
        const contentLength = contentStr.length;
        console.log(`[ContextSelectionAgent]   ${idx + 1}. [${ctx.type}] ${ctx.name} (${contentLength} 字符)`);
      });
    } else {
      console.log(`[ContextSelectionAgent] ⚠ 警告: 没有选择任何Context!`);
    }
    
    if (rejectedContexts.length > 0) {
      console.log(`[ContextSelectionAgent] ✗ 未选择的Context列表:`);
      rejectedContexts.forEach((ctx, idx) => {
        console.log(`[ContextSelectionAgent]   ${idx + 1}. [${ctx.type}] ${ctx.name}`);
      });
    }
    
    console.log('\n');
    
    return results;
  }
}

module.exports = ContextSelectionAgent;
