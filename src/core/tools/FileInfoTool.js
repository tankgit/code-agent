const Tool = require('./Tool');
const fs = require('fs').promises;
const path = require('path');

/**
 * file_info工具：获取文件信息（行数和大小）
 */
class FileInfoTool extends Tool {
  constructor(workDirectory) {
    super(
      'file_info',
      '文件信息',
      '获取指定文件的行数和大小信息。如果文件不存在，返回文件不存在的消息',
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: '要查询的文件路径（相对于工作目录）'
          }
        },
        required: ['path']
      }
    );
    this.workDirectory = workDirectory;
  }

  async execute(args) {
    const { path: filePath } = args;
    if (!filePath) {
      throw new Error('path参数是必填的');
    }
    
    const targetPath = path.resolve(this.workDirectory, filePath);

    // 安全检查：确保路径在工作目录内
    const resolved = path.resolve(targetPath);
    if (!resolved.startsWith(path.resolve(this.workDirectory))) {
      throw new Error('路径超出工作目录范围');
    }

    try {
      // 检查文件是否存在
      await fs.access(targetPath);
      
      // 获取文件统计信息
      const stats = await fs.stat(targetPath);
      
      // 检查是否为文件
      if (!stats.isFile()) {
        return {
          success: false,
          error: '指定路径不是文件'
        };
      }
      
      // 读取文件内容以计算行数
      const content = await fs.readFile(targetPath, 'utf-8');
      const lines = content.split('\n');
      const lineCount = lines.length;
      
      // 获取文件大小（字节）
      const fileSize = stats.size;
      
      // 格式化文件大小
      let sizeFormatted = '';
      if (fileSize < 1024) {
        sizeFormatted = `${fileSize} B`;
      } else if (fileSize < 1024 * 1024) {
        sizeFormatted = `${(fileSize / 1024).toFixed(2)} KB`;
      } else if (fileSize < 1024 * 1024 * 1024) {
        sizeFormatted = `${(fileSize / (1024 * 1024)).toFixed(2)} MB`;
      } else {
        sizeFormatted = `${(fileSize / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      }
      
      return {
        success: true,
        path: path.relative(this.workDirectory, targetPath),
        lineCount: lineCount,
        fileSize: fileSize,
        fileSizeFormatted: sizeFormatted
      };
    } catch (error) {
      // 如果文件不存在，返回文件不存在的消息
      if (error.code === 'ENOENT') {
        return {
          success: false,
          error: '文件不存在',
          path: path.relative(this.workDirectory, targetPath)
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = FileInfoTool;

