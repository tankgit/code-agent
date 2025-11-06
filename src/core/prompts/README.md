# Agent System Prompts

这个目录包含了所有 Agent 的 system prompt 文件。

## 文件说明

- `ThinkingAgent.txt` - 思考 Agent 的 system prompt
- `PlanningAgent.txt` - 规划 Agent 的 system prompt
- `ReflectionAgent.txt` - 反思 Agent 的 system prompt
- `InteractionAgent.txt` - 交互 Agent 的 system prompt（支持变量替换）
- `ContextSelectionAgent.txt` - 上下文选择 Agent 的 system prompt
- `ContextCompressionAgent.txt` - 上下文压缩 Agent 的 system prompt

## 使用方法

这些 prompt 文件由 `PromptLoader` 自动加载，无需手动处理。

### 变量替换

`InteractionAgent.txt` 支持变量替换，使用 `{{VARIABLE_NAME}}` 格式：
- `{{CONTEXTS}}` - 会被替换为实际的上下文信息

### 修改 Prompt

直接编辑对应的 `.txt` 文件即可。修改后：
- 缓存会被自动管理
- 应用重启后会使用新的 prompt
- 如需热更新，可以调用 `promptLoader.clearCache()`

## 注意事项

- 保持文件编码为 UTF-8
- 不要在文件名中使用特殊字符
- 变量名必须使用大写字母和下划线
