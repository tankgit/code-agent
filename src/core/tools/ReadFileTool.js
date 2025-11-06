const Tool = require('./Tool');
const fs = require('fs').promises;
const path = require('path');

/**
 * read_file工具：读取文件内容
 */
class ReadFileTool extends Tool {
  constructor(workDirectory) {
    super(
      'read_file',
      '读取文件',
      '读取指定文件的内容',
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要读取的文件路径（相对于工作目录）'
          },
          offset: {
            type: 'number',
            description: '起始行号（从1开始，可选，默认为1）'
          },
          limit: {
            type: 'number',
            description: '读取的行数（可选，默认读取全部）'
          }
        },
        required: ['path']
      }
    );
    this.workDirectory = workDirectory;
  }

  async execute(args) {
    const { path: filePath, offset = 1, limit } = args;
    const targetPath = path.resolve(this.workDirectory, filePath);

    // 安全检查：确保路径在工作目录内
    const resolved = path.resolve(targetPath);
    if (!resolved.startsWith(path.resolve(this.workDirectory))) {
      throw new Error('路径超出工作目录范围');
    }

    try {
      let content = await fs.readFile(targetPath, 'utf-8');
      
      // 按行分割
      const lines = content.split('\n');
      const totalLines = lines.length;
      
      // 计算起始和结束行号（offset从1开始）
      const startIndex = Math.max(0, offset - 1); // 转换为0-based索引
      const endIndex = limit ? Math.min(lines.length, startIndex + limit) : lines.length;
      
      // 提取指定范围的行
      const selectedLines = lines.slice(startIndex, endIndex);
      const resultContent = selectedLines.join('\n');
      
      // 如果内容被截断，添加提示
      let finalContent = resultContent;
      if (startIndex > 0 || endIndex < lines.length) {
        const info = [];
        if (startIndex > 0) {
          info.push(`前${startIndex}行已省略`);
        }
        if (endIndex < lines.length) {
          info.push(`后${lines.length - endIndex}行已省略`);
        }
        finalContent = resultContent + (resultContent ? '\n' : '') + `\n[... ${info.join('，')} ...]`;
      }

      return {
        success: true,
        path: path.relative(this.workDirectory, targetPath),
        content: finalContent,
        totalLines: totalLines,
        startLine: offset,
        endLine: endIndex,
        linesRead: selectedLines.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = ReadFileTool;
