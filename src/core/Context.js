/**
 * Context环境管理器
 */
class Context {
  constructor() {
    this.thinking = '';
    this.todos = [];
    this.reflections = [];
    this.codePool = [];
    this.memoPool = [];
    this.operationPool = [];
  }

  setThinking(content) {
    this.thinking = content;
  }

  setTodos(todos) {
    this.todos = todos;
  }

  addReflection(reflection) {
    this.reflections.push({
      timestamp: Date.now(),
      ...reflection
    });
  }

  addCode(codeItem) {
    this.codePool.push({
      timestamp: Date.now(),
      ...codeItem
    });
  }

  addMemo(memo) {
    this.memoPool.push({
      timestamp: Date.now(),
      ...memo
    });
  }

  addOperation(operation) {
    this.operationPool.push({
      timestamp: Date.now(),
      ...operation
    });
  }

  getAllContexts() {
    return [
      { name: '思考', type: 'thinking', content: this.thinking },
      { name: 'TODO列表', type: 'todos', content: this.todos },
      { name: '反思历史', type: 'reflections', content: this.reflections },
      { name: '代码环境池', type: 'code_pool', content: this.codePool },
      { name: '备忘池', type: 'memo_pool', content: this.memoPool },
      { name: '操作池', type: 'operation_pool', content: this.operationPool }
    ];
  }

  getMemoPool() {
    return this.memoPool;
  }

  toJSON() {
    return {
      thinking: this.thinking,
      todos: this.todos,
      reflections: this.reflections,
      codePool: this.codePool,
      memoPool: this.memoPool,
      operationPool: this.operationPool
    };
  }

  fromJSON(data) {
    this.thinking = data.thinking || '';
    this.todos = data.todos || [];
    this.reflections = data.reflections || [];
    this.codePool = data.codePool || [];
    this.memoPool = data.memoPool || [];
    this.operationPool = data.operationPool || [];
  }
}

module.exports = Context;
