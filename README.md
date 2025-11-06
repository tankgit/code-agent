# Code Agent - AI代码助手

基于Electron和Node.js构建的AI代码助手应用，支持多Agent协作、工具调用、会话管理等功能。

## 功能特性

1. **工作目录管理**：启动时选择工作目录
2. **AI聊天界面**：流式输出、Markdown渲染、工具调用展示
3. **设置管理**：API配置、代理设置、模型选择
4. **会话管理**：多会话支持，每个会话独立环境
5. **Context环境**：实时展示AI思考、TODO、反思、代码池、备忘池、操作池
6. **多Agent系统**：
   - 思考Agent：深度分析用户需求
   - Context选择Agent：智能选择相关环境
   - 规划Agent：生成任务计划
   - 反思Agent：评估执行结果
   - 交互Agent：执行工具调用
   - Context压缩Agent：提炼备忘和压缩历史
7. **工具系统**：支持ls、read_file等工具

## 安装

```bash
npm install
```

## 运行

```bash
npm start
```

## 项目结构

```
code agent/
├── src/
│   ├── main.js              # Electron主进程
│   ├── preload.js           # 预加载脚本
│   ├── core/                # 核心业务逻辑
│   │   ├── Agent.js         # Agent基类
│   │   ├── AgentManager.js  # Agent管理器
│   │   ├── Context.js       # Context环境管理
│   │   ├── MessageHistory.js # 会话历史管理
│   │   ├── agents/          # 各种Agent实现
│   │   └── tools/           # 工具实现
│   └── renderer/            # 渲染进程（前端）
│       ├── index.html       # 主界面
│       ├── settings.html    # 设置界面
│       ├── styles.css       # 样式
│       ├── renderer.js       # 前端逻辑
│       └── settings.js       # 设置逻辑
├── package.json
└── README.md
```

## 使用说明

1. **首次启动**：选择工作目录
2. **配置API**：点击右上角设置按钮，配置API Key、URL、模型等
3. **开始对话**：在输入框中输入需求，AI会通过多Agent协作完成任务
4. **查看Context**：右侧面板实时显示AI的思考过程、TODO列表等信息
5. **管理会话**：左侧可以新建、切换会话

## 技术栈

- Electron
- Node.js
- Axios（HTTP请求）
- Marked（Markdown渲染）
- Highlight.js（代码高亮）

## 注意事项

1. 需要配置有效的API Key才能使用
2. 支持OpenAI兼容的API格式
3. 工具调用仅在工作目录范围内进行，确保安全
4. 会话历史会自动保存，支持占位符机制节省存储空间

## 开发计划

- [ ] 完善占位符机制
- [ ] 添加更多工具（write_file、run_command等）
- [ ] 优化Context压缩算法
- [ ] 添加代码环境池的实际功能
- [ ] 改进错误处理和重试机制
