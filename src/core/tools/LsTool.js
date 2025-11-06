const Tool = require('./Tool');
const fs = require('fs').promises;
const path = require('path');

/**
 * list_directory工具：查看目录文件列表
 */
class LsTool extends Tool {
  constructor(workDirectory) {
    super(
      'list_directory',
      '查看目录',
      '列出指定目录下的文件和文件夹。path参数必须是目录，且是当前工作目录下的相对路径',
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要查看的目录路径（必须是目录，且是当前工作目录下的相对路径，必填）'
          }
        },
        required: ['path']
      }
    );
    this.workDirectory = workDirectory;
  }

  async execute(args) {
    const { path: dirPath } = args;
    if (!dirPath) {
      throw new Error('path参数是必填的');
    }
    const targetPath = path.resolve(this.workDirectory, dirPath);

    // 安全检查：确保路径在工作目录内
    const resolved = path.resolve(targetPath);
    if (!resolved.startsWith(path.resolve(this.workDirectory))) {
      throw new Error('路径超出工作目录范围');
    }

    try {
      // 检查路径是否为目录
      const stats = await fs.stat(targetPath);
      if (!stats.isDirectory()) {
        throw new Error('path参数必须是目录');
      }

      const items = await fs.readdir(targetPath, { withFileTypes: true });
      const result = items.map(item => ({
        name: item.name,
        type: item.isDirectory() ? 'directory' : 'file',
        path: path.relative(this.workDirectory, path.join(targetPath, item.name))
      }));

      return {
        success: true,
        path: path.relative(this.workDirectory, targetPath),
        items: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = LsTool;
