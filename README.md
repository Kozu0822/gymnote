# ChocoZAP Tracker 🍫⚡

一个专为 chocoZAP 便利健身房设计的健身打卡网页应用。纯前端实现（HTML/CSS/JS），无需后端，可直接部署在 GitHub Pages 上，数据保存在浏览器本地，并可选配 GitHub Gist 云同步实现多设备互通。

## ✨ 功能特性

- **卡片式打卡**：打卡页项目卡片铺满整个界面，点选项目后进入对应参数界面填写；打卡后停留在项目页方便连续打卡，不会被强制拽到历史页
- **智能默认值**：每个项目自动带出你上次的训练参数（重量/次数/组数），打卡只需几秒；重量/组数都有快捷预设标签，一键选择常用值
- **多重量组打卡**：力量项目支持"同一天同项目多重量组"——一条记录里点「＋」即可扩展不同重量的组，各组分别记录组数/次数/组外次数（金字塔、递减组也能一次记完），AI 教练的菜单设计也已适配这种结构
- **组外次数**：力量训练项目可选填"组外次数"，记录正式组数之外力竭/额外加练的次数
- **有氧变速模式**：动感单车与跑步机可勾选「变速」，分为热身段、若干变速段（不同速度各自间隔时长）、冲刺段与总时长（热身/冲刺时长可设为 0）；跑步机变速会分段估算距离与热量
- **身体数据**：记录体重（精确到小数点后一位）、臂围、腰围、胸围，在「趋势」页查看最新值、与上次的增减以及历史，可编辑/删除
- **补记功能**：打卡时可选择过去的日期，漏打的卡也能补上
- **卡路里估算**：跑步机项目基于 ACSM 公式，结合体重、速度、坡度实时估算距离与热量消耗
- **数据仪表盘**：近 7 天运动频次折线图、近 30 天力量/有氧占比与近 4 周训练容量趋势分析
- **历史记录**：按日期分组浏览全部打卡，支持按项目筛选、编辑与删除单条记录（每条记录都有编辑与删除按钮）
- **趋势页签**：
  - 打卡日历：GitHub 贡献图风格的近 1 年热力图，一眼看出哪段时间练得勤
  - 恢复进度：按各部位的训练量和间隔时间实时估算疲劳恢复百分比（腿部约需 72h、胸/背 60h、肩/臂 48h、核心 36h、有氧 24h，多次训练疲劳叠加）；AI「身体分析」的结果也会推送到这里覆盖估算值并附点评
  - 身体部位统计：近 30 天训练分布环形图，每个部位固定绑定专属颜色（配色通过了色盲区分度与对比度校验），中心显示总次数，图例带次数与占比
  - PR 个人最佳纪录：力量项目记录最大重量（连续完成 2 组以上才计入，避免单次爆发力误判），跑步机/动感单车记录最长时长；打卡或完成 AI 推荐刷新纪录时会弹出庆祝提示
- **日间/夜间模式**：右上角一键切换，偏好保存在本地，下次打开自动记住
- **AI 健身教练**（默认 **Anthropic Claude**，可切换 Google Gemini 或 ChatGPT；三种模式）：
  - **聊天**：自由提问答疑，AI 结合打卡历史回答，支持多轮上下文（真正"接着聊"，不是每次都重新总结）；不会擅自甩出训练菜单
  - **训练菜单**：对话式定制菜单（可以描述目标/时间限制），或一键生成；结构化计划推送到首页「AI 教练推荐」模块，每条推荐可「完成」（自动生成当天打卡记录，力量类支持多重量组、重量强制取整到 5kg）、「调整」（改完强度/组数/组外次数再完成）或「拒绝」；新一轮菜单会替换掉上一轮还没处理的推荐
  - **身体分析**：分析各部位训练量分布与疲劳恢复状况，结构化结果推送到趋势板块的恢复进度模块；以 App 算法估算值为锚点 + 数值格式约束保证同样的数据得到稳定一致的输出（Gemini 3 起按官方要求保持默认 temperature，不再调低，避免复读循环与推理退化；2.5 及更早的老模型仍走 temperature 0）
  - AI 的所有建议都被约束在 chocoZAP 实际器材范围内，不会推荐门店里没有的器械
  - 多会话历史记录：可以开新对话、查看/切换/删除历史对话，会话按模式标记，切换会话自动回到对应模式
  - 也可一键打包健身数据为 Prompt，粘贴到任意 AI 网页端使用（免 API Key）
- **GitHub Gist 云同步**：用你自己的 GitHub 账号作为免费私有云存储，打卡记录和「Gemini的推荐」列表会自动合并同步到所有设备，删除/完成/拒绝也会正确同步（墓碑机制，不会被另一台设备"复活"）；AI 聊天记录只保存在本地、不参与云同步（避免 Gist 文件随聊天记录无限增长）
- **备份与迁移**：一键导出/导入 JSON 备份（已自动剔除 API Key 和 GitHub Token 等敏感信息）

## 🚀 部署

本项目是纯静态页面，推荐用 GitHub Pages：

1. Fork 或克隆本仓库
2. 仓库 Settings → Pages → 选择部署分支（如 `main`）
3. 访问 `https://<你的用户名>.github.io/chocozap-tracker/`

也可以直接双击 `index.html` 在本地浏览器打开使用。

> 注意：修改代码后需要 push 到 Pages 绑定的分支，GitHub 会自动重新部署（约 1-2 分钟生效）。

## ☁️ 云同步配置（可选）

1. 在 GitHub [创建一个 Personal Access Token](https://github.com/settings/tokens)，只需勾选 `gist` 权限
2. 打开应用「设置」页，粘贴 Token 并点击「立即同步云端数据」
3. 应用会自动创建一个私有 Gist 作为云存储，并绑定 Gist ID
4. 在另一台设备上填入同一个 Token，同步时会自动找到并绑定同一个 Gist

## 🤖 AI 教练配置（可选）

应用默认直连 **Anthropic Claude**（推理与结构化输出更强，更适合训练菜单设计与恢复分析），也可在「设置」页切换 Google Gemini 或 ChatGPT（OpenAI）：

- **Claude（默认，推荐）**：在 [Anthropic 控制台](https://console.anthropic.com/settings/keys) 申请 API Key（`sk-ant-...`），默认模型 Claude Opus 4.8，可选 Sonnet 5 / Haiku 4.5
- **Gemini**：在 [Google AI Studio](https://aistudio.google.com/apikey) 免费申请 API Key（`AIzaSy...`），默认模型 Gemini 3.7 Flash（2026-08 最新，编码与 agent 能力显著增强；2026-12-31 前为介绍性定价 $0.75/$3.75 每百万 token，2027-01-01 起恢复 $1.50/$7.50），可选 Gemini 3.1 Pro（预览版，推理最强）/ Gemini 3.1 Flash-Lite（最省）。原来的 Gemini 2.5 Flash / 2.5 Pro 将于 2026-10-16 停用，已从列表中移除
- **ChatGPT（OpenAI）**：在 [OpenAI Platform](https://platform.openai.com/api-keys) 创建 API Key（`sk-proj-...`）。在组织的数据共享设置中开启「Share inputs and outputs with OpenAI」、确认已加入免费 token 计划，并保持 API 账户正余额后：GPT-5.6 Terra（250万 token/天）适合日常教练；GPT-5.6 Sol（25万 token/天）适合深度训练复盘；GPT-5.6 Luna（250万 token/天）适合轻量、快速问答。符合条件的共享流量会自动使用免费额度，超出每日池子才会按标准价格计费。ChatGPT Plus/Pro 订阅与 API 用量分开计算。

打开应用「设置」页选择提供方并粘贴对应 Key，即可在「AI教练」页直接对话。三家的 Key 各自独立保存，切换提供方互不覆盖。

> 说明：应用在浏览器端直连所选 AI 提供方的 API（Claude 会携带 `anthropic-dangerous-direct-browser-access` 头）。API Key 仅保存在你的浏览器 localStorage 中，不会上传到任何服务器，也不会包含在导出的备份文件里。

## 📁 项目结构

```
├── index.html   # 页面结构（五个页签：主页 / 打卡 / 历史 / AI教练 / 设置）
├── style.css    # 深色玻璃拟态风格样式
├── app.js       # 全部应用逻辑（本地存储、统计、云同步、AI 对接）
└── README.md
```

## 📝 数据格式

- 本地存储：`localStorage` 的 `chocozap_workouts`（打卡记录）、`chocozap_measurements`（身体数据：体重/臂围/腰围/胸围）、`chocozap_deleted`（删除墓碑）、`chocozap_settings`（配置，含 AI 提供方与各提供方 Key）、`chocozap_theme`（日间/夜间主题）、`chocozap_chat_sessions`（AI 多会话聊天记录，带模式标记）、`chocozap_ai_recommendations`（AI 训练推荐列表）、`chocozap_recovery_ai`（AI 身体分析推送的恢复数据，仅本地）
- 力量记录采用多重量组结构 `details.groups: [{ weight, reps, sets, extraReps }]`（兼容读取旧版扁平 `weight/reps/sets`）；有氧变速记录为 `details.variableSpeed / warmup / segments / sprint / time`；身体数据与设置里的 AI Key 仅本地保存，不参与 Gist 云同步
- 云端 Gist 文件 `chocozap_workouts.json`：`{ "workouts": [...], "recommendations": [...], "deleted": {...} }`（兼容读取旧版纯数组格式与更早的无 recommendations 字段格式）
- 所有日期均按**用户本地时区**记录为 `YYYY-MM-DD`
