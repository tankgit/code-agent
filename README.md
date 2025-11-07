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

## 打包为Windows可执行程序

### 安装依赖

首先确保已安装所有依赖：

```bash
npm install
```

### 打包命令

打包为Windows安装程序（推荐）：

```bash
npm run build:win
```

或者分别打包不同架构：

```bash
# 打包64位Windows程序
npm run build:win64

# 打包32位Windows程序（如果需要）
npm run build:win32
```

### 打包输出

打包完成后，生成的文件会在 `dist` 目录下：

- **NSIS安装程序**：`Code Agent-1.0.0-x64.exe` 和 `Code Agent-1.0.0-ia32.exe`
  - 双击运行安装程序
  - 可以选择安装目录
  - 会自动创建桌面快捷方式和开始菜单项

- **便携版**：`Code Agent-1.0.0-portable.exe`
  - 无需安装，直接运行
  - 适合临时使用或U盘携带

### 注意事项

1. **首次打包**：electron-builder 会自动下载所需的构建工具和 Electron 二进制文件，可能需要一些时间
2. **图标文件**（可选）：如果需要自定义应用图标，可以将 `icon.ico` 文件放在 `build` 目录下，然后在 `package.json` 的 `build.win.icon` 字段中指定路径
3. **Windows环境**：虽然可以在 macOS/Linux 上打包 Windows 程序，但建议在 Windows 系统上打包以确保最佳兼容性
4. **代码签名**（可选）：如果需要代码签名，可以在 `package.json` 的 `build.win` 配置中添加签名相关配置

### 测试打包的程序

打包完成后，可以在 Windows 系统上运行生成的可执行文件进行测试。

## 打包为macOS应用程序

### 安装依赖

首先确保已安装所有依赖：

```bash
npm install
```

### 打包命令

打包为 macOS 应用程序（推荐，自动检测架构）：

```bash
npm run build:mac
```

或者分别打包不同架构：

```bash
# 打包 Intel 架构 (x64)
npm run build:mac64

# 打包 Apple Silicon 架构 (arm64/M1/M2/M3)
npm run build:mac-arm64

# 打包通用版本（同时支持 Intel 和 Apple Silicon）
npm run build:mac-universal
```

### 打包输出

打包完成后，生成的文件会在 `dist` 目录下：

- **DMG安装包**：`Code Agent-1.0.0-x64.dmg` 和 `Code Agent-1.0.0-arm64.dmg`
  - 双击打开 DMG 文件
  - 将应用程序拖拽到 Applications 文件夹
  - 首次运行时，如果出现"无法打开，因为来自身份不明的开发者"的提示
  - 解决方法：右键点击应用 → 选择"打开" → 在弹出对话框中点击"打开"

- **ZIP压缩包**：`Code Agent-1.0.0-x64.zip` 和 `Code Agent-1.0.0-arm64.zip`
  - 解压后直接运行，无需安装
  - 适合分发或临时使用

### macOS打包注意事项

1. **系统要求**：必须在 macOS 系统上打包 macOS 应用程序
2. **代码签名**（可选但推荐）：
   - 如果需要在 App Store 发布或让用户信任应用，需要配置代码签名
   - 需要在 `package.json` 的 `build.mac` 配置中添加：
     ```json
     "identity": "Developer ID Application: Your Name (TEAM_ID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist"
     ```
3. **图标文件**（可选）：
   - 可以将 `icon.icns` 文件放在 `build` 目录下
   - 如果没有提供，electron-builder 会使用默认图标
4. **DMG背景图片**（可选）：
   - 可以将自定义的 DMG 背景图片放在 `build/dmg-background.png`
5. **首次运行安全提示**：
   - 未签名的应用首次运行时会提示"无法打开"
   - 用户需要在"系统偏好设置 → 安全性与隐私"中允许运行
   - 或右键点击应用选择"打开"

### 测试打包的程序

打包完成后，可以在 macOS 系统上双击 DMG 文件或解压 ZIP 文件进行测试。

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
