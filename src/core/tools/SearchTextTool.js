const Tool = require('./Tool');
const fs = require('fs').promises;
const path = require('path');

/**
 * search_text工具：在文件中搜索文本内容
 */
class SearchTextTool extends Tool {
  constructor(workDirectory) {
    super(
      'search_text',
      '搜索文本',
      '在指定目录下搜索匹配正则表达式的文本内容，返回匹配位置和所在行的内容',
      {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: '正则表达式模式（用于匹配文本内容）'
          },
          root_path: {
            type: 'string',
            description: '搜索根路径（相对于工作目录的相对路径）'
          },
          limit: {
            type: 'number',
            description: '结果条数限制（默认100）'
          }
        },
        required: ['pattern', 'root_path']
      }
    );
    this.workDirectory = workDirectory;
  }

  async execute(args) {
    const { pattern, root_path, limit = 100 } = args;
    if (!pattern || !root_path) {
      throw new Error('pattern和root_path参数是必填的');
    }

    const searchRoot = path.resolve(this.workDirectory, root_path);

    // 安全检查：确保路径在工作目录内
    const resolved = path.resolve(searchRoot);
    if (!resolved.startsWith(path.resolve(this.workDirectory))) {
      throw new Error('路径超出工作目录范围');
    }

    try {
      // 检查根路径是否存在且为目录
      const stats = await fs.stat(searchRoot);
      if (!stats.isDirectory()) {
        throw new Error('root_path必须是目录');
      }

      const results = [];
      let resultCount = 0;

      // 递归遍历目录
      async function searchDirectory(dirPath) {
        if (resultCount >= limit) return;

        try {
          const items = await fs.readdir(dirPath, { withFileTypes: true });

          for (const item of items) {
            if (resultCount >= limit) break;

            const itemPath = path.join(dirPath, item.name);

            // 跳过node_modules等常见目录
            if (item.isDirectory() && (item.name === 'node_modules' || item.name === '.git')) {
              continue;
            }

            if (item.isDirectory()) {
              await searchDirectory(itemPath);
            } else if (item.isFile()) {
              try {
                const content = await fs.readFile(itemPath, 'utf-8');
                const lines = content.split('\n');

                for (let i = 0; i < lines.length && resultCount < limit; i++) {
                  const line = lines[i];
                  // 每次创建新的正则表达式实例以避免lastIndex问题
                  const lineRegex = new RegExp(pattern, 'g');
                  if (lineRegex.test(line)) {
                    const relativePath = path.relative(this.workDirectory, itemPath);
                    const lineContent = line.length > 200 ? line.substring(0, 200) : line;
                    results.push({
                      index: resultCount + 1,
                      file: relativePath,
                      line: i + 1,
                      content: lineContent
                    });
                    resultCount++;
                  }
                }
              } catch (error) {
                // 忽略无法读取的文件（二进制文件等）
                continue;
              }
            }
          }
        } catch (error) {
          // 忽略无法访问的目录，直接返回
          return;
        }
      }

      await searchDirectory.call(this, searchRoot);

      // 格式化输出
      const formattedResults = results.map(r => 
        `${r.index} - ${r.file}[${r.line}]：${r.content}`
      ).join('\n');

      return {
        success: true,
        count: results.length,
        results: formattedResults
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = SearchTextTool;

