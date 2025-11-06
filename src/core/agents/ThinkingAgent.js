const Agent = require('../Agent');
const promptLoader = require('../PromptLoader');

/**
 * 思考Agent：用于分析用户消息，进行仔细思考
 */
class ThinkingAgent extends Agent {
  constructor(settings, workDirectory) {
    super(settings, workDirectory);
    this.name = 'ThinkingAgent';
  }

  getSystemPrompt() {
    const basePrompt = promptLoader.load('ThinkingAgent');
    const workDirInfo = this.workDirectory 
      ? `\n\n重要提示：当前工作目录路径为：${this.workDirectory}\n所有文件操作和路径引用都应该基于此工作目录。`
      : '\n\n重要提示：工作目录未设置。';
    return basePrompt + workDirInfo;
  }

  async think(userQuery) {
    console.log('[ThinkingAgent] think called', { userQueryLength: userQuery ? userQuery.length : 0 });
    
    const systemPrompt = this.getSystemPrompt();
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuery }
    ];
    console.log('[ThinkingAgent] Messages prepared', { systemPromptLength: systemPrompt.length, userQueryLength: userQuery.length });

    const result = await this.callChat(messages);
    const content = result.choices[0].message.content;
    console.log('[ThinkingAgent] think completed', { resultLength: content ? content.length : 0 });
    return content;
  }

  /**
   * 流式思考：逐步产出内容
   */
  async *thinkStream(userQuery) {
    console.log('[ThinkingAgent] thinkStream called', { userQueryLength: userQuery ? userQuery.length : 0 });
    const systemPrompt = this.getSystemPrompt();
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userQuery }
    ];
    let yielded = 0;
    for await (const delta of this.streamChat(messages)) {
      if (typeof delta === 'string' && delta.length > 0) {
        yielded += delta.length;
        yield delta;
      } else if (delta && delta.tool_calls) {
        // 思考阶段不应有工具调用，忽略
      }
    }
    console.log('[ThinkingAgent] thinkStream completed', { totalYielded: yielded });
  }
}

module.exports = ThinkingAgent;
