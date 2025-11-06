/**
 * 工具基类
 */
class Tool {
  constructor(name, displayName, description, schema) {
    this.name = name;
    this.displayName = displayName;
    this.description = description;
    this.schema = schema;
  }

  /**
   * 执行工具（子类需要实现）
   */
  async execute(args) {
    throw new Error('Tool.execute() must be implemented by subclass');
  }

  /**
   * 获取工具定义（用于Function Calling）
   */
  getDefinition() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: this.schema
      }
    };
  }
}

module.exports = Tool;
