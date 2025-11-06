const Agent = require('../Agent');
const promptLoader = require('../PromptLoader');

/**
 * Context压缩Agent：提炼备忘信息和压缩会话历史
 */
class ContextCompressionAgent extends Agent {
  constructor(settings, workDirectory) {
    super(settings, workDirectory);
    this.name = 'ContextCompressionAgent';
  }

  getSystemPrompt() {
    const basePrompt = promptLoader.load('ContextCompressionAgent');
    const workDirInfo = this.workDirectory 
      ? `\n\n重要提示：当前工作目录路径为：${this.workDirectory}\n所有文件操作和路径引用都应该基于此工作目录。`
      : '\n\n重要提示：工作目录未设置。';
    return basePrompt + workDirInfo;
  }

  /**
   * 提炼备忘信息
   */
  async extractMemo(agentOutput, context) {
    console.log('[ContextCompressionAgent] extractMemo called', { 
      agentOutputLength: agentOutput ? agentOutput.length : 0,
      contextLength: context ? JSON.stringify(context).length : 0
    });
    
    const prompt = `Agent输出:
${agentOutput}

当前Context:
${JSON.stringify(context, null, 2)}

请提炼出需要特殊备忘的重要信息。输出格式：
标题: [备忘标题]
内容: [备忘内容]

如果没有需要备忘的信息，输出"无"。`;

    const systemPrompt = this.getSystemPrompt();
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    const result = await this.callChat(messages);
    const content = result.choices[0].message.content.trim();
    console.log('[ContextCompressionAgent] Raw memo extraction result', { contentLength: content.length, preview: content.substring(0, 200) });
    
    if (content === '无' || content.toLowerCase().includes('无')) {
      console.log('[ContextCompressionAgent] No memo extracted');
      return null;
    }

    const titleMatch = content.match(/标题[：:]\s*(.+)/);
    const contentMatch = content.match(/内容[：:]\s*(.+)/);
    
    const memo = {
      title: titleMatch ? titleMatch[1].trim() : '备忘',
      content: contentMatch ? contentMatch[1].trim() : content
    };
    console.log('[ContextCompressionAgent] extractMemo completed', { memoTitle: memo.title, memoContentLength: memo.content.length });
    return memo;
  }

  /**
   * 压缩会话历史
   */
  async compressHistory(messages) {
    console.log('[ContextCompressionAgent] compressHistory called', { messagesCount: messages ? messages.length : 0 });
    
    const prompt = `请压缩以下会话历史，保留关键信息：

${messages.map((msg, idx) => 
  `${idx + 1}. ${msg.role}: ${msg.content.substring(0, 500)}`
).join('\n\n')}

请输出压缩后的摘要，保留所有重要信息。`;

    const systemPrompt = this.getSystemPrompt();
    const compressedMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    const result = await this.callChat(compressedMessages);
    const compressed = result.choices[0].message.content;
    console.log('[ContextCompressionAgent] compressHistory completed', { 
      originalMessagesCount: messages.length, 
      compressedLength: compressed.length 
    });
    return compressed;
  }

  /**
   * 压缩多条消息
   */
  async compressMessages(messages) {
    console.log('[ContextCompressionAgent] compressMessages called', { messagesCount: messages ? messages.length : 0 });
    
    // 分批压缩，避免超过上下文长度
    const batchSize = 10;
    const compressed = [];
    const totalBatches = Math.ceil(messages.length / batchSize);

    for (let i = 0; i < messages.length; i += batchSize) {
      const batchNumber = Math.floor(i / batchSize) + 1;
      console.log('[ContextCompressionAgent] Compressing batch', { batchNumber, totalBatches, batchStart: i + 1, batchEnd: Math.min(i + batchSize, messages.length) });
      
      const batch = messages.slice(i, i + batchSize);
      const summary = await this.compressHistory(batch);
      compressed.push({
        role: 'assistant',
        content: `[压缩摘要 ${i + 1}-${Math.min(i + batchSize, messages.length)}]: ${summary}`
      });
    }

    console.log('[ContextCompressionAgent] compressMessages completed', { 
      originalCount: messages.length, 
      compressedCount: compressed.length 
    });
    return compressed;
  }
}

module.exports = ContextCompressionAgent;
