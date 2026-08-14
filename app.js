// ChocoZAP Pro - Local Workout Tracker Logic

// ==========================================================================
// 1. 初始化状态与本地存储 (Data Initialization)
// ==========================================================================
let state = {
  workouts: [],
  // 身体数据记录（体重/臂围/腰围/胸围）：[{ id, date, weight, arm, waist, chest }]
  measurements: [],
  // 已删除记录的墓碑表 { workoutId: 删除时间戳 }，用于云同步时防止被删记录从云端"复活"
  deletedIds: {},
  settings: {
    weight: 70,
    // AI 模型提供方：'claude'（默认，推理/结构化输出更强）、'gemini' 或 'openai'
    apiProvider: 'claude',
    apiKey: '',
    // 各提供方各自保存一份 Key，切换时互不覆盖
    apiKeys: {},
    apiModel: 'claude-opus-4-8'
  },
  // AI 多会话聊天记录：[{ id, title, updatedAt, messages: [{role,name,text,time}] }]
  chatSessions: [],
  activeChatSessionId: null,
  // AI 生成的训练推荐，展示在首页"AI 教练推荐"模块
  aiRecommendations: []
};

// ==========================================================================
// AI 模型提供方配置（Claude / Gemini / OpenAI），供设置页动态填充模型下拉、决定请求方式
// ==========================================================================
const AI_PROVIDERS = {
  claude: {
    label: 'Claude (Anthropic)',
    coachName: 'Claude 教练',
    keyLabel: 'Claude API Key',
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-opus-4-8',
    hint: '在 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic 控制台</a> 申请 Claude API Key。',
    models: [
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8 (最强推理，推荐)' },
      { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (速度与质量兼顾)' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5 (最省，速度快)' }
    ]
  },
  gemini: {
    label: 'Gemini (Google)',
    coachName: 'Gemini 教练',
    keyLabel: 'Gemini API Key',
    keyPlaceholder: 'AIzaSy...',
    defaultModel: 'gemini-3.7-flash',
    hint: '在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 免费申请 Gemini API Key。',
    models: [
      { id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash (最新，推荐)' },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (推理能力强，预览版)' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash-Lite (最省，速度快)' }
    ]
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    coachName: 'ChatGPT 教练',
    keyLabel: 'OpenAI API Key',
    keyPlaceholder: 'sk-proj-...',
    defaultModel: 'gpt-5.6-terra',
    hint: '在 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI Platform</a> 创建 API Key。开启「Share inputs and outputs with OpenAI」且账户有正余额后，以下模型的共享流量会自动计入免费额度池；ChatGPT 订阅与 API 用量仍分开计算。',
    models: [
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra（默认：日常教练 / 免费 250万）' },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol（深度训练复盘 / 免费 25万）' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna（轻量快速问答 / 免费 250万）' }
    ]
  }
};

function getAiProvider() {
  return AI_PROVIDERS[state.settings.apiProvider] ? state.settings.apiProvider : 'claude';
}

function getAiCoachName() {
  return AI_PROVIDERS[getAiProvider()].coachName;
}

// ChocoZAP 门店实际可用的器材清单，用于约束 AI 只推荐这些器材范围内的动作
const EQUIPMENT_ROSTER = [
  { type: "leg_press", label: "腿举 (Leg Press)", note: "力量训练，练下肢" },
  { type: "shoulder_press", label: "肩推 (Shoulder Press)", note: "力量训练，练肩部" },
  { type: "chest_press", label: "胸推 (Chest Press)", note: "力量训练，练胸部" },
  { type: "preacher_curl", label: "牧师椅 (Preacher Curl)", note: "力量训练，练肱二头肌" },
  { type: "lat_pulldown", label: "高位下拉 (Lat Pulldown)", note: "力量训练，练背部" },
  { type: "situps", label: "仰卧起坐 (Sit-ups)", note: "核心训练" },
  { type: "spin_bike", label: "动感单车 (Spin Bike)", note: "有氧训练" },
  { type: "treadmill", label: "跑步机 (Treadmill)", note: "有氧训练" },
  { type: "massage_chair", label: "按摩椅 (Massage Chair)", note: "拉伸放松，非力量/有氧训练" }
];

// ChocoZAP 力量器械配重片的最小调整单位 (kg)，不支持 2.5kg 这种半档
const WEIGHT_STEP_KG = 5;

// 把重量取整到最近的 step 的整数倍 (用于兜底 AI 给出不合法的重量数值，如 2.5kg 的半档)
function roundToNearestStep(value, step) {
  const num = parseFloat(value) || 0;
  return Math.max(0, Math.round(num / step) * step);
}

// 每种类型打卡记录所需的必填字段，用于校验 AI 结构化训练推荐数据是否可直接落地为打卡记录
const WORKOUT_REQUIRED_FIELDS = {
  leg_press: ['weight', 'reps', 'sets'],
  shoulder_press: ['weight', 'reps', 'sets'],
  chest_press: ['weight', 'reps', 'sets'],
  preacher_curl: ['weight', 'reps', 'sets'],
  lat_pulldown: ['weight', 'reps', 'sets'],
  situps: ['reps', 'sets'],
  spin_bike: ['resistance', 'time'],
  treadmill: ['mode', 'speed', 'incline', 'time'],
  massage_chair: ['mode', 'duration', 'intensity']
};

// 预设 Mock 数据以便第一次打开时拥有绝佳的视觉体验 (若 LocalStorage 为空)
const initialMockWorkouts = [
  {
    id: "mock-1",
    date: getPastDateString(6),
    type: "treadmill",
    details: { mode: "walk", speed: 5.5, incline: 4, time: 25, distance: 2.29, calories: 155 },
    notes: "热身快走"
  },
  {
    id: "mock-2",
    date: getPastDateString(5),
    type: "leg_press",
    details: { weight: 50, reps: 12, sets: 3 },
    notes: "腿举第2台机器"
  },
  {
    id: "mock-3",
    date: getPastDateString(5),
    type: "shoulder_press",
    details: { weight: 20, reps: 10, sets: 3 },
    notes: "感觉右肩稍沉"
  },
  {
    id: "mock-4",
    date: getPastDateString(4),
    type: "spin_bike",
    details: { resistance: 8, time: 20 },
    notes: "阻力偏轻"
  },
  {
    id: "mock-5",
    date: getPastDateString(3),
    type: "chest_press",
    details: { weight: 30, reps: 12, sets: 3 },
    notes: "胸推，状态良好"
  },
  {
    id: "mock-6",
    date: getPastDateString(3),
    type: "massage_chair",
    details: { mode: "自动舒缓", duration: 30, intensity: 2 },
    notes: "全身酸痛按摩"
  },
  {
    id: "mock-7",
    date: getPastDateString(1),
    type: "leg_press",
    details: { weight: 60, reps: 10, sets: 4 },
    notes: "加重量了，小腿有点酸"
  },
  {
    id: "mock-8",
    date: getPastDateString(1),
    type: "situps",
    details: { reps: 20, sets: 3 },
    notes: "腰腹练习"
  },
  {
    id: "mock-9",
    date: getPastDateString(0), // 今天
    type: "treadmill",
    details: { mode: "run", speed: 8.5, incline: 2, time: 30, distance: 4.25, calories: 310 },
    notes: "今天跑得很爽，浑身湿透"
  }
];

// 初始化加载
document.addEventListener("DOMContentLoaded", () => {
  refreshHeaderDate();
  syncThemeToggleIcon();

  loadData();
  setupEventListeners();

  // 渲染各项页面数据
  updateStats();
  renderHistory();
  renderAiRecommendations();
  renderChatSessionMessages();
  renderChatHistoryList();

  // 默认启动估算值计算
  updateCalorieEstimate();

  // 如果配置了 GitHub Token，开机进行一次静默云同步，拉取最新记录
  if (state.settings.githubToken) {
    syncWithGithub(true);
  }
});

// 刷新顶部日期展示 (页签切换时也会调用，保证 PWA 长期驻留后台跨天后日期依然正确)
function refreshHeaderDate() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  document.getElementById("current-date").textContent = dateStr;
}

// ==========================================================================
// 日间/夜间模式切换 (Theme Toggle)
// 注意：实际主题在 <head> 内联脚本中已提前设好 data-theme 属性以避免首次渲染闪烁，
// 这里只需要在 DOM 就绪后把切换按钮的图标同步成当前主题
// ==========================================================================
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("chocozap_theme", next);
  syncThemeToggleIcon();
  // 主题切换后折线图颜色跟随 CSS 变量重绘一次即可，坐标本身不受影响
}

function syncThemeToggleIcon() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  btn.textContent = current === "light" ? "☀️" : "🌙";
}

// 从 LocalStorage 加载数据
function loadData() {
  const hasRunBefore = localStorage.getItem("chocozap_has_run_before");
  const storedWorkouts = localStorage.getItem("chocozap_workouts");
  const storedSettings = localStorage.getItem("chocozap_settings");

  // 加载已删除记录的墓碑表
  try {
    state.deletedIds = JSON.parse(localStorage.getItem("chocozap_deleted") || "{}") || {};
  } catch (e) {
    state.deletedIds = {};
  }

  // 加载 AI 训练推荐列表
  try {
    state.aiRecommendations = JSON.parse(localStorage.getItem("chocozap_ai_recommendations") || "[]") || [];
  } catch (e) {
    state.aiRecommendations = [];
  }

  // 加载身体数据记录（体重/臂围/腰围/胸围）
  try {
    state.measurements = JSON.parse(localStorage.getItem("chocozap_measurements") || "[]") || [];
  } catch (e) {
    state.measurements = [];
  }

  // 加载 AI 多会话聊天记录
  try {
    state.chatSessions = JSON.parse(localStorage.getItem("chocozap_chat_sessions") || "[]") || [];
  } catch (e) {
    state.chatSessions = [];
  }
  state.activeChatSessionId = localStorage.getItem("chocozap_active_chat_session") || null;
  if (!state.chatSessions.some(s => s.id === state.activeChatSessionId)) {
    state.activeChatSessionId = state.chatSessions.length > 0 ? state.chatSessions[0].id : null;
  }

  if (!hasRunBefore) {
    // 首次打开：加载预设 mock 数据并初始化设置，打上 has_run_before 标记
    state.workouts = initialMockWorkouts;
    state.settings = {
      weight: 70,
      apiProvider: 'claude',
      apiKey: '',
      apiKeys: {},
      apiModel: 'claude-opus-4-8',
      githubToken: '',
      githubGistId: ''
    };
    localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));
    localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
    localStorage.setItem("chocozap_has_run_before", "true");
  } else {
    // 非首次打开：直接读取已存储的数据 (如果 workouts 被删除了则默认空数组，防止重置后重新加载 mock)
    state.workouts = storedWorkouts ? JSON.parse(storedWorkouts) : [];
    
    if (storedSettings) {
      state.settings = JSON.parse(storedSettings);
    } else {
      state.settings = {
        weight: 70,
        apiProvider: 'claude',
        apiKey: '',
        apiKeys: {},
        apiModel: 'claude-opus-4-8',
        githubToken: '',
        githubGistId: ''
      };
      localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
    }
  }

  // 兼容旧版本设置：老用户此前只有 Gemini，迁移为 gemini 提供方，保留其 Key 不丢失
  if (!state.settings.apiProvider) {
    const oldModel = state.settings.apiModel || '';
    state.settings.apiProvider = oldModel.startsWith('gemini') ? 'gemini' : 'claude';
  }
  if (!state.settings.apiKeys || typeof state.settings.apiKeys !== 'object') {
    state.settings.apiKeys = {};
  }
  // 把顶层 apiKey 归档到当前提供方的 apiKeys 里（首次迁移）
  if (state.settings.apiKey && !state.settings.apiKeys[state.settings.apiProvider]) {
    state.settings.apiKeys[state.settings.apiProvider] = state.settings.apiKey;
  }

  // 将设置数据反映到 UI 控件中
  syncSettingsUI();
  document.getElementById("setting-github-token").value = state.settings.githubToken || "";
  document.getElementById("setting-github-gist-id").value = state.settings.githubGistId || "";

  // 更新云同步配置状态文本
  const syncStatus = document.getElementById("github-sync-status");
  if (syncStatus) {
    if (state.settings.githubToken && state.settings.githubGistId) {
      syncStatus.textContent = "已关联云端存储";
      syncStatus.style.color = "var(--neon-blue)";
    } else if (state.settings.githubToken) {
      syncStatus.textContent = "已配置Token，待首次同步";
      syncStatus.style.color = "var(--text-secondary)";
    } else {
      syncStatus.textContent = "未配置同步";
      syncStatus.style.color = "var(--text-secondary)";
    }
  }
}

// 辅助函数：生成本地时区的 YYYY-MM-DD 字符串
// 注意：不能用 toISOString()，它返回的是 UTC 日期。对于东八/九区用户，
// 本地凌晨到早上 8-9 点之间 UTC 日期还停留在"昨天"，会导致打卡日期错一天
function getLocalDateString(d = new Date()) {
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

// 辅助函数：把 YYYY-MM-DD 按本地时区解析为 Date
// (new Date("YYYY-MM-DD") 会按 UTC 零点解析，在西半球时区会偏移到前一天)
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// 辅助函数：生成过去某一天的 YYYY-MM-DD 字符串
function getPastDateString(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return getLocalDateString(d);
}

// ==========================================================================
// 2. 交互逻辑与事件绑定 (UI Interactions & Events)
// ==========================================================================
function setupEventListeners() {
  // 打卡页项目卡片铺满界面，点击后进入对应参数界面（事件在渲染时以 onclick 绑定）
  renderLogProjectGrid();
}

// 打卡页所有可选项目（力量 / 有氧 / 核心 / 放松 / 身体数据 / 自定义）
const LOG_PROJECTS = [
  { type: 'leg_press', icon: '🦵', name: '腿举', tag: '力量' },
  { type: 'shoulder_press', icon: '💪', name: '肩推', tag: '力量' },
  { type: 'chest_press', icon: '🏋️', name: '胸推', tag: '力量' },
  { type: 'preacher_curl', icon: '🧘', name: '牧师椅', tag: '力量' },
  { type: 'lat_pulldown', icon: '🔽', name: '高位下拉', tag: '力量' },
  { type: 'situps', icon: '🧗', name: '仰卧起坐', tag: '核心' },
  { type: 'spin_bike', icon: '🚴', name: '动感单车', tag: '有氧' },
  { type: 'treadmill', icon: '🏃', name: '跑步机', tag: '有氧' },
  { type: 'massage_chair', icon: '💆', name: '按摩椅', tag: '放松' },
  { type: 'body_metrics', icon: '📏', name: '身体数据', tag: '体测' },
  { type: 'custom', icon: '⚙️', name: '自定义', tag: '其他' }
];

// 渲染打卡页的项目卡片网格
function renderLogProjectGrid() {
  const grid = document.getElementById("log-project-grid");
  if (!grid) return;
  grid.innerHTML = LOG_PROJECTS.map(p => `
    <button type="button" class="log-project-card glass" onclick="openLogForm('${p.type}')">
      <span class="lp-icon">${p.icon}</span>
      <span class="lp-name">${p.name}</span>
      <span class="lp-tag">${p.tag}</span>
    </button>
  `).join("");
}

// 标签栏切换 (Tab Switch)
function switchTab(tabName) {
  // 移除所有导航项和视图的激活状态
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
  });
  document.querySelectorAll(".app-view").forEach(view => {
    view.classList.remove("active");
  });
  
  // 激活对应的导航和视图
  const activeNavItem = document.querySelector(`.nav-item[data-tab="${tabName}"]`);
  if (activeNavItem) activeNavItem.classList.add("active");
  
  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.add("active");

  refreshHeaderDate();

  // 重新渲染相关的数据/折线图 (有些界面需要动态重画)
  if (tabName === 'dashboard') {
    updateStats();
  } else if (tabName === 'log') {
    // 进入打卡页默认回到项目选择界面（除非正处于某个项目的参数界面）
    const formStage = document.getElementById("log-form-stage");
    if (!formStage || formStage.style.display === 'none') {
      showLogSelectStage();
    }
  } else if (tabName === 'history') {
    renderHistory();
  } else if (tabName === 'trends') {
    renderTrendsTab();
  }
}

// 快捷方式直接跳转并选择项目
function startQuickLog(type) {
  switchTab('log');
  openLogForm(type);
}

// 展示项目选择界面（隐藏参数界面）
function showLogSelectStage() {
  const selectStage = document.getElementById("log-select-stage");
  const formStage = document.getElementById("log-form-stage");
  if (selectStage) selectStage.style.display = 'block';
  if (formStage) formStage.style.display = 'none';
}

// 步进器调整数值 (Stepper Value Adjust)
function adjustValue(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;
  
  let val = parseFloat(input.value) || 0;
  val += delta;
  
  // 约束最大最小值
  const min = input.getAttribute("min");
  const max = input.getAttribute("max");
  if (min !== null && val < parseFloat(min)) val = parseFloat(min);
  if (max !== null && val > parseFloat(max)) val = parseFloat(max);
  
  // 判断是否有小数决定格式化
  const step = input.getAttribute("step");
  if (step && step.includes(".")) {
    input.value = val.toFixed(1);
  } else {
    input.value = Math.round(val);
  }
  
  // 手动触发 change 事件以便更新估计数值
  const event = new Event('change');
  input.dispatchEvent(event);
}

// 预设值快速设定 (Preset Settings)
function setPreset(inputId, value) {
  const input = document.getElementById(inputId);
  if (input) {
    input.value = value;
    const event = new Event('change');
    input.dispatchEvent(event);
  }
}

// 连动更新 Slider 标识文字
function updateSliderVal(badgeId, value) {
  const badge = document.getElementById(badgeId);
  if (badge) {
    badge.textContent = parseFloat(value).toFixed(1).replace(".0", "");
  }
}

// 使用配重片、支持"多重量组"细化打卡的力量项目
const WEIGHTED_STRENGTH = ['leg_press', 'shoulder_press', 'chest_press', 'preacher_curl', 'lat_pulldown'];

// 打卡界面各项目的标题/徽章/单组默认值
const LOG_META = {
  leg_press:      { title: '腿举 (Leg Press)',        badge: '力量训练', def: { weight: 50, reps: 12, sets: 3 } },
  shoulder_press: { title: '肩推 (Shoulder Press)',   badge: '力量训练', def: { weight: 20, reps: 10, sets: 3 } },
  chest_press:    { title: '胸推 (Chest Press)',      badge: '力量训练', def: { weight: 30, reps: 12, sets: 3 } },
  preacher_curl:  { title: '牧师椅 (Preacher Curl)',  badge: '力量训练', def: { weight: 15, reps: 12, sets: 3 } },
  lat_pulldown:   { title: '高位下拉 (Lat Pulldown)', badge: '力量训练', def: { weight: 35, reps: 12, sets: 3 } },
  situps:         { title: '仰卧起坐 (Sit-ups)',      badge: '腰腹核心' },
  spin_bike:      { title: '动感单车 (Spin Bike)',    badge: '有氧燃脂' },
  treadmill:      { title: '跑步机 (Treadmill)',      badge: '有氧训练' },
  massage_chair:  { title: '按摩椅 (Massage Chair)',  badge: '拉伸放松' },
  body_metrics:   { title: '身体数据 (Body Metrics)', badge: '体测记录' },
  custom:         { title: '自定义项目 (Custom)',     badge: '其他' }
};

// 读取一条力量记录的重量组数组（兼容旧版扁平结构 weight/reps/sets）
function getStrengthGroups(details) {
  if (!details) return [];
  if (Array.isArray(details.groups) && details.groups.length) {
    return details.groups.map(g => ({
      weight: Number(g.weight) || 0,
      reps: Number(g.reps) || 0,
      sets: Number(g.sets) || 0,
      extraReps: Number(g.extraReps) || 0
    }));
  }
  return [{
    weight: Number(details.weight) || 0,
    reps: Number(details.reps) || 0,
    sets: Number(details.sets) || 0,
    extraReps: Number(details.extraReps) || 0
  }];
}

// 打开某个项目的参数界面（editWorkout 传入时为编辑模式）
function openLogForm(type, editWorkout) {
  const meta = LOG_META[type] || { title: '运动项目', badge: '' };
  document.getElementById("log-select-stage").style.display = 'none';
  document.getElementById("log-form-stage").style.display = 'block';
  document.getElementById("input-exercise-type").value = type;
  document.getElementById("input-edit-id").value = editWorkout ? editWorkout.id : "";
  document.getElementById("form-title").textContent = meta.title;
  document.getElementById("form-badge-type").textContent = meta.badge;
  document.getElementById("log-submit-label").textContent = editWorkout ? "保存修改" : "保存本次打卡";

  // 日期选择器：编辑时用原记录日期，否则默认今天；始终不允许未来日期
  const dateInput = document.getElementById("input-workout-date");
  const today = getLocalDateString();
  if (dateInput) {
    dateInput.max = today;
    dateInput.value = editWorkout ? editWorkout.date : today;
  }
  document.getElementById("input-notes").value = editWorkout ? (editWorkout.notes || "") : "";

  // 预填数据：编辑用原记录，否则取该项目最近一次记录做智能默认
  const source = editWorkout ? editWorkout.details : (
    state.workouts.filter(w => w.type === type).sort((a, b) => new Date(b.date) - new Date(a.date))[0] || {}
  ).details;

  document.getElementById("log-form-fields").innerHTML = buildLogFormFields(type, source || {});

  // 力量项目：初始化多重量组
  if (WEIGHTED_STRENGTH.includes(type)) {
    const groups = source && (Array.isArray(source.groups) || source.weight != null)
      ? getStrengthGroups(source)
      : [Object.assign({ extraReps: 0 }, (LOG_META[type] && LOG_META[type].def) || { weight: 20, reps: 12, sets: 3 })];
    logStrengthGroups = groups.length ? groups : [{ weight: 20, reps: 12, sets: 3, extraReps: 0 }];
    renderStrengthGroups(type);
  }

  // 有氧变速：初始化变速段
  if (type === 'treadmill' || type === 'spin_bike') {
    logSegments = (source && source.variableSpeed && Array.isArray(source.segments))
      ? source.segments.map(s => ({ speed: Number(s.speed) || 0, duration: Number(s.duration) || 0 }))
      : [{ speed: (type === 'treadmill' ? 8 : 12), duration: 2 }, { speed: (type === 'treadmill' ? 5 : 6), duration: 2 }];
    renderSegments(type);
    updateCalorieEstimate();
  }

  window.scrollTo({ top: 0, behavior: 'auto' });
}

// 返回项目选择界面
function closeLogForm() {
  document.getElementById("input-edit-id").value = "";
  showLogSelectStage();
  renderLogProjectGrid();
}

// 根据类型构建参数字段 HTML
function buildLogFormFields(type, d) {
  if (WEIGHTED_STRENGTH.includes(type)) {
    return `
      <div id="strength-groups"></div>
      <button type="button" class="add-group-btn" onclick="addStrengthGroup('${type}')">
        ＋ 添加其他重量组（同一天同项目合并为一条记录）
      </button>
    `;
  }
  if (type === 'situps') {
    return buildSitupsFields(d);
  }
  if (type === 'treadmill') {
    return buildTreadmillFields(d);
  }
  if (type === 'spin_bike') {
    return buildSpinBikeFields(d);
  }
  if (type === 'massage_chair') {
    return buildMassageFields(d);
  }
  if (type === 'body_metrics') {
    return buildBodyMetricsFields(d && (d.weight != null || d.arm != null || d.waist != null || d.chest != null) ? d : null);
  }
  return buildCustomFields();
}

// ---- 力量：多重量组 ----
let logStrengthGroups = [];

function readStrengthGroupsFromDom() {
  const rows = document.querySelectorAll("#strength-groups .strength-group");
  const arr = [];
  rows.forEach(row => {
    arr.push({
      weight: parseFloat(row.querySelector('.sg-weight').value) || 0,
      reps: parseInt(row.querySelector('.sg-reps').value) || 0,
      sets: parseInt(row.querySelector('.sg-sets').value) || 0,
      extraReps: parseInt(row.querySelector('.sg-extra').value) || 0
    });
  });
  if (arr.length) logStrengthGroups = arr;
}

function renderStrengthGroups(type) {
  const container = document.getElementById("strength-groups");
  if (!container) return;
  const multi = logStrengthGroups.length > 1;
  container.innerHTML = logStrengthGroups.map((g, i) => `
    <div class="strength-group" data-idx="${i}">
      <div class="sg-head">
        <span class="sg-title">${multi ? `第 ${i + 1} 组重量` : '重量组'}</span>
        ${multi ? `<button type="button" class="sg-remove" onclick="removeStrengthGroup('${type}', ${i})">移除</button>` : ''}
      </div>
      <div class="form-row">
        <label>重量 (kg) <small>—— 以 5kg 为最小档位</small></label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease-large" onclick="adjustValue('sg-weight-${i}', -5)">-5</button>
          <input type="number" id="sg-weight-${i}" class="sg-weight" value="${g.weight}" min="0" max="300" step="5">
          <button type="button" class="step-btn increase-large" onclick="adjustValue('sg-weight-${i}', 5)">+5</button>
        </div>
      </div>
      <div class="form-row-grid">
        <div class="form-row">
          <label>每组次数</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('sg-reps-${i}', -1)">-</button>
            <input type="number" id="sg-reps-${i}" class="sg-reps" value="${g.reps}" min="1" max="100">
            <button type="button" class="step-btn increase" onclick="adjustValue('sg-reps-${i}', 1)">+</button>
          </div>
        </div>
        <div class="form-row">
          <label>组数</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('sg-sets-${i}', -1)">-</button>
            <input type="number" id="sg-sets-${i}" class="sg-sets" value="${g.sets}" min="1" max="20">
            <button type="button" class="step-btn increase" onclick="adjustValue('sg-sets-${i}', 1)">+</button>
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>组外次数 <small>—— 可选，正式组数之外力竭/额外加练</small></label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('sg-extra-${i}', -1)">-</button>
          <input type="number" id="sg-extra-${i}" class="sg-extra" value="${g.extraReps || ''}" placeholder="0" min="0" max="100">
          <button type="button" class="step-btn increase" onclick="adjustValue('sg-extra-${i}', 1)">+</button>
        </div>
      </div>
    </div>
  `).join('');
}

function addStrengthGroup(type) {
  readStrengthGroupsFromDom();
  const last = logStrengthGroups[logStrengthGroups.length - 1] || { weight: 20, reps: 12, sets: 3 };
  logStrengthGroups.push({ weight: last.weight, reps: last.reps, sets: last.sets, extraReps: 0 });
  renderStrengthGroups(type);
}

function removeStrengthGroup(type, idx) {
  readStrengthGroupsFromDom();
  if (logStrengthGroups.length <= 1) return;
  logStrengthGroups.splice(idx, 1);
  renderStrengthGroups(type);
}

// ---- 仰卧起坐 ----
function buildSitupsFields(d) {
  const reps = d.reps || 15, sets = d.sets || 3, extra = d.extraReps || '';
  return `
    <div class="form-row-grid">
      <div class="form-row">
        <label>每组次数</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('input-situps-reps', -5)">-5</button>
          <input type="number" id="input-situps-reps" value="${reps}" min="1" max="200">
          <button type="button" class="step-btn increase" onclick="adjustValue('input-situps-reps', 5)">+5</button>
        </div>
      </div>
      <div class="form-row">
        <label>组数</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('input-situps-sets', -1)">-</button>
          <input type="number" id="input-situps-sets" value="${sets}" min="1" max="20">
          <button type="button" class="step-btn increase" onclick="adjustValue('input-situps-sets', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>组外次数 <small>—— 可选</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('input-situps-extra-reps', -1)">-</button>
        <input type="number" id="input-situps-extra-reps" value="${extra}" placeholder="0" min="0" max="200">
        <button type="button" class="step-btn increase" onclick="adjustValue('input-situps-extra-reps', 1)">+</button>
      </div>
    </div>
  `;
}

// ---- 有氧：变速段（跑步机 / 单车共用） ----
let logSegments = [];

function readSegmentsFromDom() {
  const rows = document.querySelectorAll("#var-segments .var-seg");
  const arr = [];
  rows.forEach(row => {
    arr.push({
      speed: parseFloat(row.querySelector('.seg-speed').value) || 0,
      duration: parseFloat(row.querySelector('.seg-dur').value) || 0
    });
  });
  logSegments = arr;
}

function renderSegments(type) {
  const container = document.getElementById("var-segments");
  if (!container) return;
  const unit = type === 'treadmill' ? 'km/h' : '档';
  const step = type === 'treadmill' ? '0.5' : '1';
  container.innerHTML = logSegments.map((s, i) => `
    <div class="var-seg" data-idx="${i}">
      <div class="var-seg-fields">
        <div class="form-row">
          <label>速度 (${unit})</label>
          <input type="number" class="seg-speed glass-input" value="${s.speed}" min="0" max="24" step="${step}" oninput="updateCalorieEstimate()">
        </div>
        <div class="form-row">
          <label>间隔时长 (分钟)</label>
          <input type="number" class="seg-dur glass-input" value="${s.duration}" min="0" max="180" step="1" oninput="updateCalorieEstimate()">
        </div>
      </div>
      ${logSegments.length > 1 ? `<button type="button" class="sg-remove" onclick="removeSegment('${type}', ${i})">移除</button>` : ''}
    </div>
  `).join('');
}

function addSegment(type) {
  readSegmentsFromDom();
  const last = logSegments[logSegments.length - 1] || { speed: (type === 'treadmill' ? 6 : 8), duration: 2 };
  logSegments.push({ speed: last.speed, duration: last.duration });
  renderSegments(type);
  updateCalorieEstimate();
}

function removeSegment(type, idx) {
  readSegmentsFromDom();
  logSegments.splice(idx, 1);
  if (logSegments.length === 0) logSegments.push({ speed: (type === 'treadmill' ? 6 : 8), duration: 2 });
  renderSegments(type);
  updateCalorieEstimate();
}

// 切换变速模式显示
function onVarSpeedToggle(type) {
  const on = document.getElementById("var-speed-toggle").checked;
  const simple = document.getElementById(type === 'treadmill' ? 'tm-simple' : 'bike-simple');
  const variable = document.getElementById("var-speed-block");
  if (simple) simple.style.display = on ? 'none' : 'block';
  if (variable) variable.style.display = on ? 'block' : 'none';
  if (on && logSegments.length === 0) {
    logSegments = [{ speed: (type === 'treadmill' ? 8 : 12), duration: 2 }, { speed: (type === 'treadmill' ? 5 : 6), duration: 2 }];
    renderSegments(type);
  }
  updateCalorieEstimate();
}

// 变速段公共区块（热身 / 变速段 / 冲刺 / 总时长）
function buildVariableBlock(type, d) {
  const unit = type === 'treadmill' ? 'km/h' : '档';
  const step = type === 'treadmill' ? '0.5' : '1';
  const wu = (d && d.warmup) || { speed: 0, duration: 0 };
  const sp = (d && d.sprint) || { speed: 0, duration: 0 };
  const total = (d && d.variableSpeed && d.time) ? d.time : '';
  const inclineRow = type === 'treadmill' ? `
      <div class="form-row">
        <label>坡度 (%)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('input-tmv-incline', -1); updateCalorieEstimate();">-</button>
          <input type="number" id="input-tmv-incline" value="${(d && d.incline != null) ? d.incline : 2}" min="0" max="15" onchange="updateCalorieEstimate()">
          <button type="button" class="step-btn increase" onclick="adjustValue('input-tmv-incline', 1); updateCalorieEstimate();">+</button>
        </div>
      </div>` : '';
  const estRow = type === 'treadmill' ? `
      <div class="form-row estimation-output">
        <div class="est-box"><span class="est-label">预计距离</span><span class="est-value" id="est-distance-var">0.00 <small>km</small></span></div>
        <div class="est-box"><span class="est-label">预计消耗</span><span class="est-value text-glowing" id="est-calories-var">0 <small>kcal</small></span></div>
      </div>` : '';
  return `
    <div id="var-speed-block" style="display:${(d && d.variableSpeed) ? 'block' : 'none'}">
      ${inclineRow}
      <div class="var-sub-title">🔥 热身段 <small>（速度与时长可留 0）</small></div>
      <div class="var-seg-fields">
        <div class="form-row"><label>速度 (${unit})</label><input type="number" id="vs-warmup-speed" class="glass-input" value="${wu.speed || 0}" min="0" max="24" step="${step}" oninput="updateCalorieEstimate()"></div>
        <div class="form-row"><label>时长 (分钟)</label><input type="number" id="vs-warmup-dur" class="glass-input" value="${wu.duration || 0}" min="0" max="180" step="1" oninput="updateCalorieEstimate()"></div>
      </div>
      <div class="var-sub-title">⚡ 变速段 <small>（不同速度与各自间隔时长）</small></div>
      <div id="var-segments"></div>
      <button type="button" class="add-group-btn" onclick="addSegment('${type}')">＋ 添加一个变速段</button>
      <div class="var-sub-title">🚀 冲刺段 <small>（速度与时长可留 0）</small></div>
      <div class="var-seg-fields">
        <div class="form-row"><label>速度 (${unit})</label><input type="number" id="vs-sprint-speed" class="glass-input" value="${sp.speed || 0}" min="0" max="24" step="${step}" oninput="updateCalorieEstimate()"></div>
        <div class="form-row"><label>时长 (分钟)</label><input type="number" id="vs-sprint-dur" class="glass-input" value="${sp.duration || 0}" min="0" max="180" step="1" oninput="updateCalorieEstimate()"></div>
      </div>
      <div class="form-row">
        <label>总时长 (分钟) <small>—— 留空则按各段之和</small></label>
        <input type="number" id="vs-total" class="glass-input" value="${total}" min="0" max="300" step="1" placeholder="各段之和" oninput="updateCalorieEstimate()">
      </div>
      ${estRow}
    </div>
  `;
}

// ---- 跑步机 ----
function buildTreadmillFields(d) {
  const variable = !!(d && d.variableSpeed);
  const mode = (d && d.mode) || 'walk';
  const speed = (d && !variable && d.speed) ? d.speed : 6.0;
  const incline = (d && d.incline != null) ? d.incline : 3;
  const time = (d && !variable && d.time) ? d.time : 30;
  return `
    <div class="form-row var-toggle-row">
      <label class="var-toggle"><input type="checkbox" id="var-speed-toggle" ${variable ? 'checked' : ''} onchange="onVarSpeedToggle('treadmill')"> 变速模式（分段配速）</label>
    </div>
    <div id="tm-simple" style="display:${variable ? 'none' : 'block'}">
      <div class="form-row">
        <label>运动类型</label>
        <div class="segmented-control">
          <label class="segment-item"><input type="radio" name="treadmill-mode" value="walk" ${mode === 'walk' ? 'checked' : ''} onchange="updateCalorieEstimate()"><span>🚶 快走</span></label>
          <label class="segment-item"><input type="radio" name="treadmill-mode" value="run" ${mode === 'run' ? 'checked' : ''} onchange="updateCalorieEstimate()"><span>🏃 跑步</span></label>
        </div>
      </div>
      <div class="form-row-grid">
        <div class="form-row">
          <label>速度 (km/h)</label>
          <div class="slider-container">
            <input type="range" id="input-treadmill-speed" min="2" max="20" step="0.5" value="${speed}" oninput="updateSliderVal('treadmill-speed-val', this.value); updateCalorieEstimate();">
            <span class="slider-badge"><span id="treadmill-speed-val">${speed}</span> km/h</span>
          </div>
        </div>
        <div class="form-row">
          <label>坡度 (%)</label>
          <div class="slider-container">
            <input type="range" id="input-treadmill-incline" min="0" max="15" step="1" value="${incline}" oninput="updateSliderVal('treadmill-incline-val', this.value); updateCalorieEstimate();">
            <span class="slider-badge"><span id="treadmill-incline-val">${incline}</span> %</span>
          </div>
        </div>
      </div>
      <div class="form-row-grid">
        <div class="form-row">
          <label>时长 (分钟)</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('input-treadmill-time', -5); updateCalorieEstimate();">-5</button>
            <input type="number" id="input-treadmill-time" value="${time}" min="1" max="180" onchange="updateCalorieEstimate()">
            <button type="button" class="step-btn increase" onclick="adjustValue('input-treadmill-time', 5); updateCalorieEstimate();">+5</button>
          </div>
        </div>
        <div class="form-row estimation-output">
          <div class="est-box"><span class="est-label">预计距离</span><span class="est-value" id="est-distance">3.00 <small>km</small></span></div>
          <div class="est-box"><span class="est-label">预计消耗</span><span class="est-value text-glowing" id="est-calories">185 <small>kcal</small></span></div>
        </div>
      </div>
    </div>
    ${buildVariableBlock('treadmill', d)}
  `;
}

// ---- 动感单车 ----
function buildSpinBikeFields(d) {
  const variable = !!(d && d.variableSpeed);
  const resistance = (d && !variable && d.resistance) ? d.resistance : 8;
  const time = (d && !variable && d.time) ? d.time : 20;
  return `
    <div class="form-row var-toggle-row">
      <label class="var-toggle"><input type="checkbox" id="var-speed-toggle" ${variable ? 'checked' : ''} onchange="onVarSpeedToggle('spin_bike')"> 变速模式（分段配速）</label>
    </div>
    <div id="bike-simple" style="display:${variable ? 'none' : 'block'}">
      <div class="form-row-grid">
        <div class="form-row">
          <label>阻力档位 (1-24)</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('input-bike-resistance', -1)">-</button>
            <input type="number" id="input-bike-resistance" value="${resistance}" min="1" max="24">
            <button type="button" class="step-btn increase" onclick="adjustValue('input-bike-resistance', 1)">+</button>
          </div>
        </div>
        <div class="form-row">
          <label>骑行时长 (分钟)</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('input-bike-time', -5)">-5</button>
            <input type="number" id="input-bike-time" value="${time}" min="1" max="180">
            <button type="button" class="step-btn increase" onclick="adjustValue('input-bike-time', 5)">+5</button>
          </div>
        </div>
      </div>
    </div>
    ${buildVariableBlock('spin_bike', d)}
  `;
}

// ---- 按摩椅 ----
function buildMassageFields(d) {
  const mode = (d && d.mode) || '自动舒缓';
  const duration = (d && d.duration) || 30;
  const intensity = (d && d.intensity) || 2;
  const modes = ['自动舒缓', '颈肩重点', '全身拉伸', '腰臀放松'];
  const durations = [15, 30, 45, 60, 75, 90, 105, 120];
  const durLabels = { 15: '15 分钟', 30: '30 分钟', 45: '45 分钟', 60: '1 小时', 75: '1 小时 15 分', 90: '1 小时 30 分', 105: '1 小时 45 分', 120: '2 小时' };
  return `
    <div class="form-row">
      <label>按摩模式</label>
      <div class="glass-select-wrapper">
        <select id="input-massage-mode">${modes.map(m => `<option value="${m}" ${m === mode ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>按摩时长</label>
        <div class="glass-select-wrapper">
          <select id="input-massage-duration">${durations.map(v => `<option value="${v}" ${v === Number(duration) ? 'selected' : ''}>${durLabels[v]}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <label>强度级别</label>
        <div class="segmented-control">
          <label class="segment-item"><input type="radio" name="massage-intensity" value="1" ${intensity == 1 ? 'checked' : ''}><span>弱</span></label>
          <label class="segment-item"><input type="radio" name="massage-intensity" value="2" ${intensity == 2 ? 'checked' : ''}><span>中</span></label>
          <label class="segment-item"><input type="radio" name="massage-intensity" value="3" ${intensity == 3 ? 'checked' : ''}><span>强</span></label>
        </div>
      </div>
    </div>
  `;
}

// ---- 自定义 ----
function buildCustomFields() {
  return `
    <div class="form-row">
      <label>运动项目名称</label>
      <input type="text" id="input-custom-name" placeholder="请输入运动名称 (例如: 哑铃飞鸟)" class="glass-input">
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>关键数据 (如重量/次数)</label>
        <input type="text" id="input-custom-value" placeholder="例如: 15kg / 12次" class="glass-input">
      </div>
      <div class="form-row">
        <label>组数 (非必填)</label>
        <input type="number" id="input-custom-sets" placeholder="例如: 3" class="glass-input" min="1">
      </div>
    </div>
  `;
}

// ---- 身体数据（体重/臂围/腰围/胸围） ----
function buildBodyMetricsFields(existing) {
  // 预填：编辑传入 existing，否则取最近一次身体数据；体重再兜底到设置体重
  const last = existing || (state.measurements && state.measurements.length ? state.measurements[0] : null) || {};
  const weight = last.weight != null ? Number(last.weight).toFixed(1) : (Number(state.settings.weight) || 70).toFixed(1);
  return `
    <div class="form-row">
      <label>体重 (kg) <small>—— 精确到小数点后一位</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('input-bm-weight', -0.5)">-</button>
        <input type="number" id="input-bm-weight" value="${weight}" min="20" max="300" step="0.1">
        <button type="button" class="step-btn increase" onclick="adjustValue('input-bm-weight', 0.5)">+</button>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>臂围 (cm)</label>
        <input type="number" id="input-bm-arm" class="glass-input" value="${last.arm != null ? last.arm : ''}" placeholder="选填" min="0" max="100" step="0.1">
      </div>
      <div class="form-row">
        <label>腰围 (cm)</label>
        <input type="number" id="input-bm-waist" class="glass-input" value="${last.waist != null ? last.waist : ''}" placeholder="选填" min="0" max="200" step="0.1">
      </div>
    </div>
    <div class="form-row">
      <label>胸围 (cm)</label>
      <input type="number" id="input-bm-chest" class="glass-input" value="${last.chest != null ? last.chest : ''}" placeholder="选填" min="0" max="200" step="0.1">
    </div>
  `;
}

// ==========================================================================
// 3. 卡路里与有氧指标计算算法 (Calorie Algorithm)
// ==========================================================================
function updateCalorieEstimate() {
  const typeEl = document.getElementById("input-exercise-type");
  const type = typeEl ? typeEl.value : '';
  if (type !== 'treadmill') return; // 目前仅跑步机做距离/热量估算

  const varToggle = document.getElementById("var-speed-toggle");
  const variable = varToggle && varToggle.checked;

  if (variable) {
    const est = computeVariableTreadmillFromDom();
    const distEl = document.getElementById("est-distance-var");
    const calEl = document.getElementById("est-calories-var");
    if (distEl) distEl.innerHTML = `${est.distance.toFixed(2)} <small>km</small>`;
    if (calEl) calEl.innerHTML = `${est.calories} <small>kcal</small>`;
    return est;
  }

  const modeEl = document.querySelector('input[name="treadmill-mode"]:checked');
  const speedEl = document.getElementById("input-treadmill-speed");
  if (!modeEl || !speedEl) return;
  const mode = modeEl.value; // 'walk' or 'run'
  const speed = parseFloat(speedEl.value) || 0; // km/h
  const incline = parseFloat(document.getElementById("input-treadmill-incline").value) || 0; // %
  const time = parseFloat(document.getElementById("input-treadmill-time").value) || 0; // min

  const est = computeTreadmillEstimate(mode, speed, incline, time);
  const distEl = document.getElementById("est-distance");
  const calEl = document.getElementById("est-calories");
  if (distEl) distEl.innerHTML = `${est.distance.toFixed(2)} <small>km</small>`;
  if (calEl) calEl.innerHTML = `${est.calories} <small>kcal</small>`;

  return { distance: parseFloat(est.distance.toFixed(2)), calories: est.calories };
}

// 从变速表单读取分段配置
function readVariableTreadmillFromDom() {
  readSegmentsFromDom();
  const num = id => parseFloat((document.getElementById(id) || {}).value) || 0;
  return {
    incline: num('input-tmv-incline'),
    warmup: { speed: num('vs-warmup-speed'), duration: num('vs-warmup-dur') },
    segments: logSegments.map(s => ({ speed: s.speed, duration: s.duration })),
    sprint: { speed: num('vs-sprint-speed'), duration: num('vs-sprint-dur') },
    total: num('vs-total')
  };
}

function computeVariableTreadmillFromDom() {
  const cfg = readVariableTreadmillFromDom();
  return computeVariableTreadmill(cfg.incline, cfg.warmup, cfg.segments, cfg.sprint, cfg.total);
}

// 变速跑步机的距离/热量估算：对热身段、各变速段、冲刺段分别用 ACSM 公式估算后求和；
// 若填写了总时长且大于各段之和，则按比例放大（把总时长视为整段训练的真实时长）
function computeVariableTreadmill(incline, warmup, segments, sprint, total) {
  const parts = [warmup, ...(segments || []), sprint].filter(p => p && p.speed > 0 && p.duration > 0);
  let dist = 0, cal = 0, partsSum = 0;
  parts.forEach(p => {
    const e = computeTreadmillEstimate('auto', p.speed, incline || 0, p.duration);
    dist += e.distance;
    cal += e.calories;
    partsSum += p.duration;
  });
  let time = partsSum;
  if (total && partsSum > 0 && total > partsSum) {
    const scale = total / partsSum;
    dist *= scale;
    cal *= scale;
    time = total;
  } else if (total && partsSum === 0) {
    time = total;
  }
  return { distance: parseFloat(dist.toFixed(2)), calories: Math.round(cal), time };
}

// 纯函数版跑步机估算 (不依赖 DOM)，供表单实时预览和 AI 推荐一键打卡复用，保证两处口径一致
function computeTreadmillEstimate(mode, speed, incline, time) {
  // 1. 距离计算: Speed(km/h) * Time(min) / 60
  const distance = speed * (time / 60);

  // 2. 卡路里计算采用 ACSM（美国运动医学学会）公式：
  // 速度转化：1 km/h = 16.667 米/分钟
  const speedMetersPerMin = speed * 16.667;
  const gradeFraction = incline / 100;

  let met = 3.5; // 基础代谢 1 MET = 3.5 ml/kg/min VO2

  if (mode === "walk" || speed < 6.0) {
    // 步行公式: VO2 = 0.1 * speed + 1.8 * speed * grade + 3.5
    const vo2 = 0.1 * speedMetersPerMin + 1.8 * speedMetersPerMin * gradeFraction + 3.5;
    met = vo2 / 3.5;
  } else {
    // 跑步公式: VO2 = 0.2 * speed + 0.9 * speed * grade + 3.5
    const vo2 = 0.2 * speedMetersPerMin + 0.9 * speedMetersPerMin * gradeFraction + 3.5;
    met = vo2 / 3.5;
  }

  // 安全限制合理范围
  if (met < 2.0) met = 2.0;
  if (met > 18.0) met = 18.0;

  // 用户身体重量
  const weight = state.settings.weight || 70;

  // 消耗卡路里公式: kcal = (MET * 3.5 * weight * time) / 200
  const calories = Math.round((met * 3.5 * weight * time) / 200);

  return { distance: parseFloat(distance.toFixed(2)), calories };
}

// ==========================================================================
// 4. 保存运动记录 (Save Log)
// ==========================================================================
function saveWorkout(event) {
  event.preventDefault();

  const type = document.getElementById("input-exercise-type").value;
  if (!type) return;

  const editId = document.getElementById("input-edit-id").value;

  // 打卡日期：优先取用户在日期选择器中选定的日期 (支持补记)，默认为本地时区的今天
  const dateToday = getLocalDateString();
  const dateInput = document.getElementById("input-workout-date");
  let workoutDate = (dateInput && dateInput.value) ? dateInput.value : dateToday;
  if (workoutDate > dateToday) workoutDate = dateToday; // 禁止未来日期

  // 身体数据走独立存储，单独处理后返回
  if (type === 'body_metrics') {
    saveBodyMetrics(workoutDate, editId);
    return;
  }

  const notes = document.getElementById("input-notes").value.trim();
  let details = {};

  // 提取对应表单参数
  if (WEIGHTED_STRENGTH.includes(type)) {
    readStrengthGroupsFromDom();
    const groups = logStrengthGroups
      .map(g => ({ weight: g.weight || 0, reps: g.reps || 0, sets: g.sets || 0, extraReps: g.extraReps || 0 }))
      .filter(g => g.reps > 0 && g.sets > 0);
    if (groups.length === 0) {
      alert("请至少填写一组有效的次数与组数！");
      return;
    }
    details = { groups: groups };
  } else if (type === 'situps') {
    details = {
      reps: parseInt(document.getElementById("input-situps-reps").value) || 0,
      sets: parseInt(document.getElementById("input-situps-sets").value) || 0,
      extraReps: parseInt(document.getElementById("input-situps-extra-reps").value) || 0
    };
  } else if (type === 'spin_bike') {
    const varToggle = document.getElementById("var-speed-toggle");
    if (varToggle && varToggle.checked) {
      const cfg = readVariableTreadmillFromDom(); // 复用读取逻辑（单位为档位，字段名沿用 speed）
      const partsSum = cfg.warmup.duration + cfg.segments.reduce((s, x) => s + x.duration, 0) + cfg.sprint.duration;
      details = {
        variableSpeed: true,
        warmup: cfg.warmup,
        segments: cfg.segments,
        sprint: cfg.sprint,
        time: cfg.total || partsSum
      };
    } else {
      details = {
        resistance: parseInt(document.getElementById("input-bike-resistance").value) || 0,
        time: parseInt(document.getElementById("input-bike-time").value) || 0
      };
    }
  } else if (type === 'treadmill') {
    const varToggle = document.getElementById("var-speed-toggle");
    if (varToggle && varToggle.checked) {
      const cfg = readVariableTreadmillFromDom();
      const est = computeVariableTreadmill(cfg.incline, cfg.warmup, cfg.segments, cfg.sprint, cfg.total);
      details = {
        variableSpeed: true,
        incline: cfg.incline,
        warmup: cfg.warmup,
        segments: cfg.segments,
        sprint: cfg.sprint,
        time: est.time,
        distance: est.distance,
        calories: est.calories
      };
    } else {
      const est = updateCalorieEstimate();
      details = {
        mode: document.querySelector('input[name="treadmill-mode"]:checked').value,
        speed: parseFloat(document.getElementById("input-treadmill-speed").value) || 0,
        incline: parseFloat(document.getElementById("input-treadmill-incline").value) || 0,
        time: parseInt(document.getElementById("input-treadmill-time").value) || 0,
        distance: est.distance,
        calories: est.calories
      };
    }
  } else if (type === 'massage_chair') {
    details = {
      mode: document.getElementById("input-massage-mode").value,
      duration: parseInt(document.getElementById("input-massage-duration").value) || 0,
      intensity: parseInt(document.querySelector('input[name="massage-intensity"]:checked').value) || 2
    };
  } else if (type === 'custom') {
    const customName = document.getElementById("input-custom-name").value.trim();
    if (!customName) {
      alert("请输入自定义项目的运动名称！");
      return;
    }
    details = {
      name: customName,
      value: document.getElementById("input-custom-value").value.trim(),
      sets: parseInt(document.getElementById("input-custom-sets").value) || null
    };
  }

  if (editId) {
    // 编辑模式：原地更新记录，保留 id
    const idx = state.workouts.findIndex(w => w.id === editId);
    if (idx !== -1) {
      state.workouts[idx] = Object.assign({}, state.workouts[idx], { date: workoutDate, type: type, details: details, notes: notes });
      localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));
      checkAndCelebratePR(state.workouts[idx]);
    }
  } else {
    // 新增模式：构建单条 Workout 对象 (id 附加随机后缀，避免同一毫秒内连续打卡产生重复 id)
    const newWorkout = {
      id: "workout-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      date: workoutDate,
      type: type,
      details: details,
      notes: notes
    };
    state.workouts.unshift(newWorkout);
    localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));
    checkAndCelebratePR(newWorkout);
  }

  if (state.settings.githubToken) {
    syncWithGithub(true);
  }

  onWorkoutSaved(editId ? "✅ 修改已保存！" : "🎉 打卡成功！", !!editId);
}

// 打卡/编辑成功后的统一收尾：提示成功；新增打卡停留在打卡页返回项目网格（方便连续打卡），
// 编辑则回到历史页查看结果
function onWorkoutSaved(text, isEdit) {
  const submitBtn = document.querySelector(".btn-submit-workout");
  if (submitBtn) {
    const originalHtml = submitBtn.innerHTML;
    submitBtn.innerHTML = text;
    submitBtn.style.background = "linear-gradient(135deg, #39ff14, #00f0ff)";
    setTimeout(() => {
      submitBtn.innerHTML = originalHtml;
      submitBtn.style.background = "";
    }, 1000);
  }

  updateStats();
  renderHistory();

  setTimeout(() => {
    if (isEdit) {
      switchTab('history');
    } else {
      // 打卡后不跳历史，回到项目选择界面，方便继续给下一个项目打卡
      document.getElementById("input-edit-id").value = "";
      renderLogProjectGrid();
      showLogSelectStage();
    }
  }, 900);
}

// 保存身体数据（体重/臂围/腰围/胸围）——独立存储 chocozap_measurements
function saveBodyMetrics(date, editId) {
  const num = id => {
    const v = document.getElementById(id).value;
    return v === '' ? null : (Math.round(parseFloat(v) * 10) / 10);
  };
  const weight = num('input-bm-weight');
  const arm = num('input-bm-arm');
  const waist = num('input-bm-waist');
  const chest = num('input-bm-chest');

  if (weight == null && arm == null && waist == null && chest == null) {
    alert("请至少填写一项身体数据！");
    return;
  }

  const record = { date: date, weight: weight, arm: arm, waist: waist, chest: chest };

  if (editId) {
    const idx = state.measurements.findIndex(m => m.id === editId);
    if (idx !== -1) state.measurements[idx] = Object.assign({}, state.measurements[idx], record);
  } else {
    record.id = "bm-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    state.measurements.push(record);
  }
  // 按日期从新到旧排序，方便"最近一次"读取
  state.measurements.sort((a, b) => new Date(b.date) - new Date(a.date));
  localStorage.setItem("chocozap_measurements", JSON.stringify(state.measurements));

  // 同步更新设置里的体重（用于跑步机热量估算）
  if (weight != null) {
    state.settings.weight = weight;
    localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
    syncSettingsUI();
  }

  onWorkoutSaved(editId ? "✅ 身体数据已更新！" : "📏 身体数据已记录！", false);
}

// 从趋势页编辑一条身体数据
function editMeasurement(id) {
  const m = state.measurements.find(x => x.id === id);
  if (!m) return;
  switchTab('log');
  openLogForm('body_metrics', { id: m.id, date: m.date, details: { weight: m.weight, arm: m.arm, waist: m.waist, chest: m.chest } });
}

// 删除一条身体数据
function deleteMeasurement(id) {
  if (!confirm("确定删除这条身体数据吗？")) return;
  state.measurements = state.measurements.filter(m => m.id !== id);
  localStorage.setItem("chocozap_measurements", JSON.stringify(state.measurements));
  renderBodyMetrics();
}

// 删除某条打卡记录
function deleteWorkout(id) {
  if (confirm("确定要删除这条打卡记录吗？此操作无法撤销。")) {
    state.workouts = state.workouts.filter(w => w.id !== id);
    // 写入墓碑：云同步合并时据此排除该记录，防止删除后被云端数据"复活"
    state.deletedIds[id] = Date.now();
    localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));
    localStorage.setItem("chocozap_deleted", JSON.stringify(state.deletedIds));
    renderHistory();
    updateStats();
    
    // 如果配置了 GitHub Token，进行静默云同步，同步删除操作到云端
    if (state.settings.githubToken) {
      syncWithGithub(true);
    }
  }
}

// ==========================================================================
// 5. 统计与仪表盘数据展示 (Dashboard & Streak)
// ==========================================================================
function updateStats() {
  // 本周运动折线图 + 力量/有氧趋势分析（首页已移除连续打卡/累计次数/今日目标进度模块）
  drawWeeklyChart();
  renderTrendAnalysis();
}

// 一条力量记录的总容量 Σ(重量×次数×组数)，兼容多重量组与旧扁平结构
function strengthVolume(details) {
  return getStrengthGroups(details).reduce((sum, g) => sum + (g.weight || 0) * (g.reps || 0) * (g.sets || 0), 0);
}

// 力量训练 vs 有氧训练的类型分类，供趋势分析和统计使用
const STRENGTH_TYPES = ['leg_press', 'shoulder_press', 'chest_press', 'preacher_curl', 'lat_pulldown', 'situps'];
const CARDIO_TYPES = ['treadmill', 'spin_bike'];

// 趋势分析模块：最近30天力量/有氧/其他占比 + 最近4周力量容量与有氧时长趋势
function renderTrendAnalysis() {
  const proportionBar = document.getElementById("trend-proportion-bar");
  if (!proportionBar) return; // 页面还未加入该模块时直接跳过

  const today = new Date();

  // A. 近 30 天 力量/有氧/其他 占比
  const cutoff30 = new Date(today);
  cutoff30.setDate(cutoff30.getDate() - 29);
  const cutoff30Str = getLocalDateString(cutoff30);

  let strengthCount = 0, cardioCount = 0, otherCount = 0;
  state.workouts.forEach(w => {
    if (w.date < cutoff30Str) return;
    if (STRENGTH_TYPES.includes(w.type)) strengthCount++;
    else if (CARDIO_TYPES.includes(w.type)) cardioCount++;
    else otherCount++;
  });
  const total = strengthCount + cardioCount + otherCount;

  const strengthPct = total > 0 ? Math.round((strengthCount / total) * 100) : 0;
  const cardioPct = total > 0 ? Math.round((cardioCount / total) * 100) : 0;
  const otherPct = total > 0 ? 100 - strengthPct - cardioPct : 0;

  if (total === 0) {
    proportionBar.innerHTML = `<div class="trend-bar-segment trend-bar-empty" style="width:100%"></div>`;
  } else {
    proportionBar.innerHTML = `
      <div class="trend-bar-segment trend-bar-strength" style="width:${strengthPct}%" title="力量+核心 ${strengthCount}次"></div>
      <div class="trend-bar-segment trend-bar-cardio" style="width:${cardioPct}%" title="有氧 ${cardioCount}次"></div>
      <div class="trend-bar-segment trend-bar-other" style="width:${otherPct}%" title="其他 ${otherCount}次"></div>
    `;
  }
  document.getElementById("trend-legend-strength").textContent = `力量 ${strengthCount}次 (${strengthPct}%)`;
  document.getElementById("trend-legend-cardio").textContent = `有氧 ${cardioCount}次 (${cardioPct}%)`;
  document.getElementById("trend-legend-other").textContent = `其他 ${otherCount}次 (${otherPct}%)`;

  // B. 近 4 周 力量训练容量 (Σ weight×reps×sets) 与 有氧时长 (分钟) 趋势
  // weekBuckets[3] 是本周（含今天往前推 6 天），weekBuckets[0] 是最早的一周
  const weekVolume = [0, 0, 0, 0];
  const weekCardioMinutes = [0, 0, 0, 0];

  state.workouts.forEach(w => {
    const d = parseLocalDate(w.date);
    const diffDays = Math.floor((today - d) / 86400000);
    if (diffDays < 0 || diffDays >= 28) return;
    const weekIdx = 3 - Math.floor(diffDays / 7);

    if (WEIGHTED_STRENGTH.includes(w.type) && w.details) {
      weekVolume[weekIdx] += strengthVolume(w.details);
    }
    if (w.type === 'treadmill' || w.type === 'spin_bike') {
      weekCardioMinutes[weekIdx] += (w.details.time || 0);
    }
  });

  renderTrendMiniBars("trend-volume-bars", weekVolume, "kg");
  renderTrendMiniBars("trend-cardio-bars", weekCardioMinutes, "分钟");
}

// 绘制 4 周迷你柱状趋势图 (纯 DOM/CSS，不用 SVG，轻量实现)
function renderTrendMiniBars(containerId, values, unit) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const maxVal = Math.max(...values, 1);
  const weekLabels = ["3周前", "2周前", "上周", "本周"];

  container.innerHTML = values.map((val, idx) => {
    const heightPct = Math.max(Math.round((val / maxVal) * 100), val > 0 ? 6 : 2);
    const isCurrent = idx === values.length - 1;
    return `
      <div class="trend-mini-bar-col">
        <span class="trend-mini-bar-value">${val > 0 ? Math.round(val) : ''}</span>
        <div class="trend-mini-bar-track">
          <div class="trend-mini-bar-fill ${isCurrent ? 'trend-mini-bar-current' : ''}" style="height:${heightPct}%"></div>
        </div>
        <span class="trend-mini-bar-label">${weekLabels[idx]}</span>
      </div>
    `;
  }).join('');
}

// ==========================================================================
// 5.1 "趋势"页签：打卡日历 / 身体部位统计 / PR 个人最佳纪录
// ==========================================================================

// 每种运动项目归属的身体部位/训练类别，用于身体部位统计模块
const BODY_PART_MAP = {
  leg_press: '腿部',
  shoulder_press: '肩部',
  chest_press: '胸部',
  preacher_curl: '手臂',
  lat_pulldown: '背部',
  situps: '核心',
  spin_bike: '有氧',
  treadmill: '有氧',
  massage_chair: '放松恢复',
  custom: '其他'
};

// PR (个人最佳纪录) 覆盖范围：力量类记重量，有氧类记时长。
// 力量类要求 sets > 1 (连续完成2组以上) 才计入，避免单次爆发力被误判为可持续的真实水平；
// 有氧类没有"组"的概念，时长本身就能直接反映真实水平，不需要额外门槛
const PR_WEIGHT_TYPES = ['leg_press', 'shoulder_press', 'chest_press', 'preacher_curl', 'lat_pulldown'];
const PR_DURATION_TYPES = ['treadmill', 'spin_bike'];

const PR_TYPE_LABELS = {
  leg_press: '腿举', shoulder_press: '肩推', chest_press: '胸推',
  preacher_curl: '牧师椅', lat_pulldown: '高位下拉',
  treadmill: '跑步机', spin_bike: '动感单车'
};

const PR_TYPE_ICONS = {
  leg_press: '🦵', shoulder_press: '💪', chest_press: '🏋️',
  preacher_curl: '🧘', lat_pulldown: '🔽', treadmill: '🏃', spin_bike: '🚴'
};

// 从单条打卡记录里提取"是否够格参与 PR 评比"的数值，不够格 (比如力量只做了1组) 返回 null
function getQualifyingPRValue(workout) {
  const d = workout.details || {};
  if (PR_WEIGHT_TYPES.includes(workout.type)) {
    // 多重量组：取"连续完成 2 组以上"的那些组里最大的重量作为 PR 候选
    const qualifying = getStrengthGroups(d).filter(g => g.sets > 1 && g.weight > 0);
    if (qualifying.length === 0) return null;
    const maxWeight = Math.max.apply(null, qualifying.map(g => g.weight));
    return { value: maxWeight, unit: 'kg' };
  }
  if (PR_DURATION_TYPES.includes(workout.type)) {
    if (!d.time) return null;
    return { value: d.time, unit: '分钟' };
  }
  return null;
}

// 计算某个类型当前的最佳纪录；excludeWorkoutId 用于"看看这条记录是否打破了它之前的最高值"
function computeBestForType(type, excludeWorkoutId) {
  let best = null;
  state.workouts.forEach(w => {
    if (w.type !== type) return;
    if (excludeWorkoutId && w.id === excludeWorkoutId) return;
    const q = getQualifyingPRValue(w);
    if (!q) return;
    if (!best || q.value > best.value) {
      best = { value: q.value, unit: q.unit, date: w.date };
    }
  });
  return best;
}

// 计算所有 PR 类型当前的最佳纪录，供"个人最佳纪录"模块渲染
function computeAllPersonalRecords() {
  return [...PR_WEIGHT_TYPES, ...PR_DURATION_TYPES]
    .map(type => ({ type, best: computeBestForType(type) }))
    .filter(r => r.best);
}

// 打卡 / 完成 AI 推荐后调用：检查这条新记录是否刷新了 PR，是的话弹出庆祝提示
function checkAndCelebratePR(workout) {
  const q = getQualifyingPRValue(workout);
  if (!q) return;

  const priorBest = computeBestForType(workout.type, workout.id);
  if (priorBest && q.value <= priorBest.value) return; // 没有刷新纪录

  const label = PR_TYPE_LABELS[workout.type] || workout.type;
  const icon = PR_TYPE_ICONS[workout.type] || '🏆';
  const msg = priorBest
    ? `${icon} 新纪录！${label} ${q.value}${q.unit}（超越 ${priorBest.value}${q.unit}）`
    : `${icon} 首个纪录！${label} ${q.value}${q.unit}`;
  showPRToast(msg);
}

// 展示 PR 新纪录提示条 (挂在 app-shell 下的 fixed 元素，不受页签切换/滚动位置影响)
let prToastTimer = null;
function showPRToast(message) {
  const toast = document.getElementById("pr-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("show"); // 连续触发时先强制重置一次，保证动画能重新播放
  void toast.offsetWidth; // 触发重排
  toast.classList.add("show");

  clearTimeout(prToastTimer);
  prToastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3800);
}

// 切换到"趋势"页签时统一刷新三个子模块
function renderTrendsTab() {
  renderCalendarHeatmap();
  renderBodyMetrics();
  renderRecoveryStatus();
  renderBodyPartStats();
  renderPersonalRecords();
}

// ---- 身体数据（体重/臂围/腰围/胸围）最新值 + 迷你趋势 ----
function renderBodyMetrics() {
  const container = document.getElementById("body-metrics-content");
  if (!container) return;

  const list = (state.measurements || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">📏</div><p>还没有身体数据，去「打卡 → 身体数据」记录一次吧</p></div>`;
    return;
  }

  const metrics = [
    { key: 'weight', label: '体重', unit: 'kg' },
    { key: 'arm', label: '臂围', unit: 'cm' },
    { key: 'waist', label: '腰围', unit: 'cm' },
    { key: 'chest', label: '胸围', unit: 'cm' }
  ];

  // 每项取最近一次的有效值，并计算与上一次有效值的差
  const cards = metrics.map(m => {
    const series = list.filter(x => x[m.key] != null);
    if (series.length === 0) return '';
    const latest = series[0];
    const prev = series[1];
    let delta = '';
    if (prev) {
      const diff = Math.round((latest[m.key] - prev[m.key]) * 10) / 10;
      if (diff !== 0) {
        const arrow = diff > 0 ? '▲' : '▼';
        const cls = diff > 0 ? 'bm-up' : 'bm-down';
        delta = `<span class="bm-delta ${cls}">${arrow} ${Math.abs(diff)}</span>`;
      }
    }
    return `
      <div class="bm-card">
        <span class="bm-label">${m.label}</span>
        <span class="bm-value">${latest[m.key]}<small>${m.unit}</small></span>
        ${delta}
      </div>
    `;
  }).join('');

  // 最近记录列表（可编辑/删除）
  const rows = list.slice(0, 6).map(m => {
    const parts = [];
    if (m.weight != null) parts.push(`${m.weight}kg`);
    if (m.arm != null) parts.push(`臂${m.arm}`);
    if (m.waist != null) parts.push(`腰${m.waist}`);
    if (m.chest != null) parts.push(`胸${m.chest}`);
    const p = m.date.split('-');
    const dateLabel = `${parseInt(p[1])}月${parseInt(p[2])}日`;
    return `
      <div class="bm-row">
        <span class="bm-row-date">${dateLabel}</span>
        <span class="bm-row-vals">${parts.join(' · ')}</span>
        <span class="bm-row-actions">
          <button class="bm-row-btn" onclick="editMeasurement('${m.id}')" title="编辑">✎</button>
          <button class="bm-row-btn" onclick="deleteMeasurement('${m.id}')" title="删除">✕</button>
        </span>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="bm-cards">${cards}</div><div class="bm-list">${rows}</div>`;
}

// ---- 打卡日历 (GitHub 贡献图风格，近53周) ----
function renderCalendarHeatmap() {
  const container = document.getElementById("calendar-heatmap-inner");
  const scrollWrapper = document.getElementById("calendar-heatmap-scroll");
  if (!container) return;

  const WEEKS = 53;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 让最右侧一列固定落在"本周"，起点回推到 53 周前那一周的周日 (跟 GitHub 贡献图对齐方式一致)
  const todayDow = today.getDay(); // 0=周日
  const gridEnd = new Date(today);
  gridEnd.setDate(gridEnd.getDate() + (6 - todayDow));
  const gridStart = new Date(gridEnd);
  gridStart.setDate(gridStart.getDate() - (WEEKS * 7 - 1));

  // 统计每天的打卡次数
  const countByDate = {};
  state.workouts.forEach(w => {
    countByDate[w.date] = (countByDate[w.date] || 0) + 1;
  });

  const monthLabels = [];
  let lastMonth = -1;
  const weekColumns = [];

  for (let w = 0; w < WEEKS; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const cellDate = new Date(gridStart);
      cellDate.setDate(cellDate.getDate() + w * 7 + d);
      const dateStr = getLocalDateString(cellDate);
      const isFuture = cellDate > today;
      const count = countByDate[dateStr] || 0;
      days.push({ date: dateStr, count, isFuture });

      if (d === 0 && cellDate.getDate() <= 7 && cellDate <= today && cellDate.getMonth() !== lastMonth) {
        monthLabels.push({ weekIndex: w, label: `${cellDate.getMonth() + 1}月` });
        lastMonth = cellDate.getMonth();
      }
    }
    weekColumns.push(days);
  }

  const levelFor = (count) => {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count === 2) return 2;
    if (count === 3) return 3;
    return 4;
  };

  let monthRowHtml = `<div class="calendar-month-row">`;
  for (let w = 0; w < WEEKS; w++) {
    const monthEntry = monthLabels.find(m => m.weekIndex === w);
    monthRowHtml += `<span class="calendar-month-label">${monthEntry ? monthEntry.label : ''}</span>`;
  }
  monthRowHtml += `</div>`;

  let gridHtml = `<div class="calendar-grid">`;
  weekColumns.forEach(days => {
    gridHtml += `<div class="calendar-week-col">`;
    days.forEach(day => {
      if (day.isFuture) {
        gridHtml += `<i class="heatmap-cell level-future"></i>`;
      } else {
        gridHtml += `<i class="heatmap-cell level-${levelFor(day.count)}" title="${day.date}：${day.count}项运动"></i>`;
      }
    });
    gridHtml += `</div>`;
  });
  gridHtml += `</div>`;

  container.innerHTML = monthRowHtml + gridHtml;

  // 默认滚动到最右侧 (今天所在的位置)，跟 GitHub 贡献图一样默认看到最新的部分
  if (scrollWrapper) {
    requestAnimationFrame(() => { scrollWrapper.scrollLeft = scrollWrapper.scrollWidth; });
  }
}

// ---- 身体部位统计 (近30天) ----
// 每个身体部位的固定专属颜色 (CSS 变量名，深浅两套主题在 style.css 中各自定义并通过了配色校验)。
// 颜色跟随部位实体固定绑定、按此顺序排列扇区，保证同一部位在任何时候颜色一致且相邻扇区色相错开
const BODY_PART_ORDER = ['腿部', '胸部', '背部', '肩部', '核心', '手臂', '有氧', '放松恢复', '其他'];
const BODY_PART_COLOR_VARS = {
  '腿部': '--part-legs', '胸部': '--part-chest', '背部': '--part-back',
  '肩部': '--part-shoulders', '核心': '--part-core', '手臂': '--part-arms',
  '有氧': '--part-cardio', '放松恢复': '--part-recovery', '其他': '--part-other'
};

function renderBodyPartStats() {
  const donutContainer = document.getElementById("body-part-donut");
  const legendContainer = document.getElementById("body-part-legend");
  if (!donutContainer || !legendContainer) return;

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - 29);
  const cutoffStr = getLocalDateString(cutoff);

  const counts = {};
  state.workouts.forEach(w => {
    if (w.date < cutoffStr) return;
    const part = BODY_PART_MAP[w.type] || '其他';
    counts[part] = (counts[part] || 0) + 1;
  });

  // 按固定顺序排列 (颜色跟随实体，不随数量排名变动)
  const entries = BODY_PART_ORDER.filter(p => counts[p] > 0).map(p => [p, counts[p]]);
  const total = entries.reduce((sum, [, c]) => sum + c, 0);

  if (total === 0) {
    donutContainer.innerHTML = "";
    legendContainer.innerHTML = `<div class="empty-state"><div class="empty-emoji">🗒️</div><p>最近30天还没有打卡记录</p></div>`;
    return;
  }

  // ---- SVG 环形图 ----
  const size = 160;
  const cx = size / 2, cy = size / 2;
  const radius = 62;
  const strokeWidth = 26;
  const circumference = 2 * Math.PI * radius;
  // 扇区间隙固定 2px (换算成周长占比)；只有一个分类时不留缝，画整圆
  const gapPx = entries.length > 1 ? 2 : 0;

  const polar = (angleDeg, r) => {
    const rad = (angleDeg - 90) * Math.PI / 180; // -90° 让起点在12点钟方向
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };

  const gapDeg = (gapPx / circumference) * 360;
  let angleCursor = 0;
  let arcsHtml = "";

  entries.forEach(([part, count]) => {
    const sweep = (count / total) * 360;
    const startAngle = angleCursor + gapDeg / 2;
    const endAngle = angleCursor + sweep - gapDeg / 2;
    angleCursor += sweep;
    if (endAngle <= startAngle) return; // 极小扇区被间隙吃掉时跳过 (数量为0不会出现，防御处理)

    const colorVar = BODY_PART_COLOR_VARS[part] || '--part-other';
    const pct = Math.round((count / total) * 100);

    if (entries.length === 1) {
      // 只有一个分类：画完整圆环 (arc 路径无法表达 360°)
      arcsHtml = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="var(${colorVar})" stroke-width="${strokeWidth}" class="donut-arc"><title>${part}：${count}次 (100%)</title></circle>`;
      return;
    }

    const [x1, y1] = polar(startAngle, radius);
    const [x2, y2] = polar(endAngle, radius);
    const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
    arcsHtml += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}"
      fill="none" stroke="var(${colorVar})" stroke-width="${strokeWidth}" stroke-linecap="butt" class="donut-arc">
      <title>${part}：${count}次 (${pct}%)</title></path>`;
  });

  donutContainer.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="近30天身体部位训练分布">
      ${arcsHtml}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-value">${total}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-center-label">次训练</text>
    </svg>
  `;

  // ---- 图例：色点 + 名称 + 次数(%)，文字用文本色而非系列色 ----
  legendContainer.innerHTML = entries.map(([part, count]) => {
    const pct = Math.round((count / total) * 100);
    const colorVar = BODY_PART_COLOR_VARS[part] || '--part-other';
    return `
      <div class="body-part-legend-item">
        <i class="legend-dot" style="background: var(${colorVar})"></i>
        <span class="legend-name">${part}</span>
        <span class="legend-value">${count}次 (${pct}%)</span>
      </div>
    `;
  }).join('');
}

// ---- 恢复进度 (Recovery) ----
// 这是「训练日志驱动的疲劳估算」，不是医学诊断。大肌群(腿/胸/背) 48-72h，
// 小肌群(肩/臂)约48h，核心更快，有氧系统通常次日恢复。
const RECOVERY_HOURS = {
  '腿部': 72, '胸部': 60, '背部': 60, '肩部': 48, '手臂': 48, '核心': 36, '有氧': 24
};

// 主肌群权重为 1，协同肌群按较低权重计入。以前「手臂」只认牧师椅，
// 会漏掉胸推 / 肩推 / 高位下拉带来的肱三头或肱二头疲劳，因而很容易长期显示 100%。
const RECOVERY_MUSCLE_CONTRIBUTIONS = {
  leg_press: [{ part: '腿部', weight: 1 }],
  shoulder_press: [{ part: '肩部', weight: 1 }, { part: '手臂', weight: 0.3 }, { part: '胸部', weight: 0.15 }],
  chest_press: [{ part: '胸部', weight: 1 }, { part: '手臂', weight: 0.35 }, { part: '肩部', weight: 0.25 }],
  preacher_curl: [{ part: '手臂', weight: 1 }],
  lat_pulldown: [{ part: '背部', weight: 1 }, { part: '手臂', weight: 0.45 }],
  situps: [{ part: '核心', weight: 1 }],
  spin_bike: [{ part: '有氧', weight: 1 }, { part: '腿部', weight: 0.3 }],
  treadmill: [{ part: '有氧', weight: 1 }, { part: '腿部', weight: 0.35 }]
};

// 单次训练的起始疲劳。日志没有 RPE、力竭与具体结束时间，故意不把普通 3 组
// 直接判作 0% 恢复；组数 / 时长越高，疲劳越高。
function workoutFatigueFactor(w) {
  const d = w.details || {};
  if (CARDIO_TYPES.includes(w.type)) {
    const t = d.time || 0;
    return t >= 60 ? 0.7 : t >= 45 ? 0.58 : t >= 30 ? 0.46 : t >= 15 ? 0.32 : 0.2;
  }
  // 力量：多重量组时按总组数衡量疲劳（各组组数相加）
  const sets = WEIGHTED_STRENGTH.includes(w.type)
    ? getStrengthGroups(d).reduce((s, g) => s + (g.sets || 0), 0)
    : (d.sets || 0);
  return sets >= 7 ? 0.85 : sets >= 5 ? 0.7 : sets >= 3 ? 0.55 : sets === 2 ? 0.42 : 0.28;
}

function getRecoveryInputFingerprint() {
  // 用恢复相关的输入做签名。新增、编辑或删除训练后，旧 AI 覆盖值会自动失效。
  return state.workouts
    .map(w => `${w.id}|${w.date}|${w.type}|${JSON.stringify(w.details || {})}|${w.notes || ''}`)
    .sort()
    .join('~');
}

// 计算所有部位当前的恢复百分比 (0-100，算法确定性输出)
function computeRecoveryStatus() {
  const now = new Date();
  const fatigueByPart = {};
  Object.keys(RECOVERY_HOURS).forEach(part => { fatigueByPart[part] = 0; });

  // 只看最近10天的记录；超过最长恢复窗口后自然不会留下疲劳。
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 10);
  const cutoffStr = getLocalDateString(cutoff);

  state.workouts.forEach(w => {
    if (w.date < cutoffStr) return;
    const contributions = RECOVERY_MUSCLE_CONTRIBUTIONS[w.type] || [];
    if (contributions.length === 0) return; // 放松恢复 / 自定义项目不做臆测

    const workoutTime = parseLocalDate(w.date);
    // 记录没有具体时刻时，把当天训练视作刚完成，避免晨间查看时出现负经过时间。
    workoutTime.setHours(20, 0, 0, 0);
    const elapsedHours = Math.max(0, (now - workoutTime) / 3600000);
    const baseFatigue = workoutFatigueFactor(w);

    contributions.forEach(({ part, weight }) => {
      const recoveryHours = RECOVERY_HOURS[part];
      if (!recoveryHours) return;
      // 多次训练按剩余疲劳叠加；最大封顶 90%，让页面不把一般训练误显示成「完全报废」。
      const residual = baseFatigue * weight * Math.max(0, 1 - elapsedHours / recoveryHours);
      fatigueByPart[part] = Math.min(0.9, fatigueByPart[part] + residual);
    });
  });

  return Object.fromEntries(Object.entries(fatigueByPart).map(([part, fatigue]) => [
    part,
    Math.max(10, Math.min(100, Math.round((1 - fatigue) * 100 / 5) * 5))
  ]));
}

function recoveryStatusLabel(pct) {
  if (pct >= 80) return { text: '已恢复', cls: 'recovery-ok' };
  if (pct >= 40) return { text: '恢复中', cls: 'recovery-mid' };
  return { text: '疲劳', cls: 'recovery-low' };
}

function renderRecoveryStatus() {
  const container = document.getElementById("recovery-list");
  const sourceLabel = document.getElementById("recovery-source-label");
  const aiSummaryBox = document.getElementById("recovery-ai-summary");
  if (!container) return;

  const algoValues = computeRecoveryStatus();

  // AI 身体分析推送的数据 (若有)，按部位覆盖算法值并附点评
  let aiData = null;
  try {
    aiData = JSON.parse(localStorage.getItem("chocozap_recovery_ai") || "null");
  } catch (e) { aiData = null; }
  const aiParts = {};
  if (aiData && Array.isArray(aiData.parts)) {
    aiData.parts.forEach(p => {
      if (RECOVERY_HOURS[p.part] !== undefined && typeof p.recovery === 'number') {
        aiParts[p.part] = { recovery: Math.max(0, Math.min(100, Math.round(p.recovery))), comment: typeof p.comment === 'string' ? p.comment : '' };
      }
    });
  }
  // AI 分析是一次性的快照；训练记录改变后，旧结论不能继续覆盖实时算法。
  const isAiCurrent = aiData && aiData.workoutFingerprint === getRecoveryInputFingerprint();
  const hasAi = isAiCurrent && Object.keys(aiParts).length > 0;

  if (sourceLabel) {
    if (hasAi && aiData.updatedAt) {
      const d = new Date(aiData.updatedAt);
      sourceLabel.textContent = `AI 分析 · ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    } else {
      sourceLabel.textContent = "按训练量与间隔实时估算";
    }
  }

  if (aiSummaryBox) {
    if (hasAi && aiData.summary) {
      aiSummaryBox.style.display = "block";
      aiSummaryBox.innerHTML = `<span class="recovery-summary-icon">🩺</span>${aiData.summary}
        <button class="recovery-clear-ai" onclick="clearAiRecoveryAnalysis()" title="清除AI分析，恢复算法估算">✕</button>`;
    } else {
      aiSummaryBox.style.display = "none";
      aiSummaryBox.innerHTML = "";
    }
  }

  container.innerHTML = Object.keys(RECOVERY_HOURS).map(part => {
    const ai = aiParts[part];
    const pct = ai ? ai.recovery : algoValues[part];
    const status = recoveryStatusLabel(pct);
    return `
      <div class="recovery-row">
        <div class="recovery-row-top">
          <span class="recovery-part-name">${part}${ai ? '<i class="recovery-ai-badge">AI</i>' : ''}</span>
          <span class="recovery-status-chip ${status.cls}">${status.text} ${pct}%</span>
        </div>
        <div class="recovery-bar-track">
          <div class="recovery-bar-fill ${status.cls}" style="width:${pct}%"></div>
        </div>
        ${ai && ai.comment ? `<div class="recovery-comment">${ai.comment}</div>` : ''}
      </div>
    `;
  }).join('');
}

// 清除 AI 分析结果，恢复到纯算法估算
function clearAiRecoveryAnalysis() {
  localStorage.removeItem("chocozap_recovery_ai");
  renderRecoveryStatus();
}

// ---- PR 个人最佳纪录列表 ----
function renderPersonalRecords() {
  const container = document.getElementById("pr-list");
  if (!container) return;

  const records = computeAllPersonalRecords();
  if (records.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">🏆</div><p>还没有达标的 PR 记录，力量项目练到连续2组以上就会被记录哦</p></div>`;
    return;
  }

  container.innerHTML = records.map(({ type, best }) => `
    <div class="pr-item">
      <div class="pr-item-left">
        <div class="pr-item-avatar">${PR_TYPE_ICONS[type] || '🏆'}</div>
        <div class="pr-item-details">
          <span class="pr-item-title">${PR_TYPE_LABELS[type] || type}</span>
          <span class="pr-item-date">${best.date}</span>
        </div>
      </div>
      <span class="pr-item-value">${best.value}${best.unit}</span>
    </div>
  `).join('');
}

// 原生绘制发光的 SVG 趋势折线图
function drawWeeklyChart() {
  const container = document.getElementById("weekly-chart-container");
  if (!container) return;
  
  // 获取近 7 天的数据分布
  const labels = [];
  const counts = [];
  
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = getLocalDateString(d);
    
    // 日期简称 (如 "7.03" 或 "周五")
    const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    labels.push(i === 0 ? "今天" : weekDays[d.getDay()]);
    
    // 统计当日打卡数量
    const dayCount = state.workouts.filter(w => w.date === dateStr).length;
    counts.push(dayCount);
  }
  
  // SVG 宽高
  const width = container.clientWidth || 350;
  const height = 110;
  const paddingX = 30;
  const paddingY = 20;
  
  const maxVal = Math.max(...counts, 2); // 至少是2作Y轴上限
  
  // 映射点坐标
  const points = counts.map((val, idx) => {
    const x = paddingX + (idx / (counts.length - 1)) * (width - paddingX * 2);
    const y = height - paddingY - (val / maxVal) * (height - paddingY * 2);
    return { x, y, val };
  });
  
  // 构建 SVG 路径 (平滑贝塞尔曲线)
  let dPath = "";
  if (points.length > 0) {
    dPath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const p0 = points[i - 1];
      const p1 = points[i];
      // 控制点
      const cpX1 = p0.x + (p1.x - p0.x) / 2;
      const cpY1 = p0.y;
      const cpX2 = p0.x + (p1.x - p0.x) / 2;
      const cpY2 = p1.y;
      dPath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${p1.x} ${p1.y}`;
    }
  }
  
  // 下方填充渐变阴影路径
  let fillPath = "";
  if (points.length > 0) {
    fillPath = `${dPath} L ${points[points.length - 1].x} ${height - paddingY} L ${points[0].x} ${height - paddingY} Z`;
  }
  
  // 组合成 SVG HTML
  let svgHTML = `
    <svg class="chart-svg" width="${width}" height="${height}">
      <!-- 渐变阴影滤镜 -->
      <defs>
        <linearGradient id="chart-fill-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffd000" stop-opacity="0.25" />
          <stop offset="100%" stop-color="#ffd000" stop-opacity="0" />
        </linearGradient>
        <filter id="neon-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      
      <!-- 背景网格横线 -->
      <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
      <line x1="${paddingX}" y1="${(height - paddingY * 2) / 2 + paddingY}" x2="${width - paddingX}" y2="${(height - paddingY * 2) / 2 + paddingY}" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
      <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="rgba(255,255,255,0.07)" stroke-width="1.5" />
      
      <!-- 渐变填充阴影 -->
      <path d="${fillPath}" fill="url(#chart-fill-grad)" />
      
      <!-- 趋势曲线 -->
      <path d="${dPath}" fill="none" stroke="#ffd000" stroke-width="3" filter="url(#neon-glow)" />
      
      <!-- 点与标示 -->
  `;
  
  points.forEach((p, idx) => {
    // 绘制活跃状态的数据点
    const isActive = p.val > 0;
    svgHTML += `
      <circle cx="${p.x}" cy="${p.y}" r="${isActive ? 4 : 2}" fill="${isActive ? '#ffd000' : 'rgba(255,255,255,0.2)'}" stroke="${isActive ? '#ffffff' : 'none'}" stroke-width="1.5" />
    `;
    
    // 如果有锻炼数值，在点上方写个小数字
    if (isActive) {
      svgHTML += `
        <text x="${p.x}" y="${p.y - 10}" fill="#ffd000" font-size="10" font-weight="700" text-anchor="middle" font-family="Outfit">${p.val}</text>
      `;
    }
    
    // X轴标签
    svgHTML += `
      <text x="${p.x}" y="${height - 4}" fill="${idx === 6 ? '#ffffff' : 'rgba(255,255,255,0.4)'}" font-size="10" font-weight="500" text-anchor="middle">${labels[idx]}</text>
    `;
  });
  
  svgHTML += `</svg>`;
  container.innerHTML = svgHTML;
}

// ==========================================================================
// 6. 渲染历史打卡记录 (Render History)
// ==========================================================================
// 历史卡片的图标与标题
function historyMeta(item) {
  const map = {
    leg_press: { icon: '🦵', title: '腿举 (Leg Press)' },
    shoulder_press: { icon: '💪', title: '肩推 (Shoulder Press)' },
    chest_press: { icon: '🏋️', title: '胸推 (Chest Press)' },
    preacher_curl: { icon: '🧘', title: '牧师椅 (Preacher Curl)' },
    lat_pulldown: { icon: '🔽', title: '高位下拉 (Lat Pulldown)' },
    situps: { icon: '🧗', title: '仰卧起坐 (Sit-ups)' },
    spin_bike: { icon: '🚴', title: '动感单车 (Spin Bike)' },
    massage_chair: { icon: '💆', title: '按摩椅' },
    custom: { icon: '⚙️', title: item.details && item.details.name ? item.details.name : '自定义项目' }
  };
  if (item.type === 'treadmill') {
    const t = item.details && item.details.variableSpeed ? '变速' : (item.details && item.details.mode === 'walk' ? '快走' : '慢跑');
    return { icon: '🏃', title: `跑步机 (${t})` };
  }
  if (item.type === 'massage_chair') {
    return { icon: '💆', title: `按摩椅 (${(item.details && item.details.mode) || '按摩'})` };
  }
  return map[item.type] || { icon: '⚙️', title: '健身运动' };
}

// 变速有氧的分段文字摘要
function formatVariableSummary(d, unit) {
  const parts = [];
  if (d.warmup && d.warmup.duration > 0) parts.push(`热身 ${d.warmup.speed}${unit}×${d.warmup.duration}分`);
  (d.segments || []).forEach(s => { if (s.duration > 0) parts.push(`${s.speed}${unit}×${s.duration}分`); });
  if (d.sprint && d.sprint.duration > 0) parts.push(`冲刺 ${d.sprint.speed}${unit}×${d.sprint.duration}分`);
  return parts.join(' → ');
}

// 历史卡片的数据摘要文字
function historyStatsText(item) {
  const d = item.details || {};
  if (WEIGHTED_STRENGTH.includes(item.type)) {
    const groups = getStrengthGroups(d);
    return groups.map(g => `${g.weight}kg × ${g.reps}次 × ${g.sets}组` + (g.extraReps ? ` (+组外${g.extraReps}次)` : "")).join(' ／ ');
  }
  if (item.type === 'situps') {
    return `${d.reps}次 × ${d.sets}组` + (d.extraReps ? ` (+组外${d.extraReps}次)` : "");
  }
  if (item.type === 'spin_bike') {
    if (d.variableSpeed) {
      return `变速骑行 ${d.time}分钟 | ${formatVariableSummary(d, '档')}`;
    }
    return `阻力 ${d.resistance}档 | 骑行 ${d.time}分钟`;
  }
  if (item.type === 'treadmill') {
    if (d.variableSpeed) {
      return `变速 ${d.time}分钟 | 坡度 ${d.incline || 0}% | ${d.distance}km | 约 ${d.calories}kcal｜${formatVariableSummary(d, 'km/h')}`;
    }
    return `${d.time}分钟 | 速度 ${d.speed}km/h | 坡度 ${d.incline}% | ${d.distance}km | 约 ${d.calories}kcal`;
  }
  if (item.type === 'massage_chair') {
    const intensityMap = { 1: '弱', 2: '中', 3: '强' };
    return `时长 ${d.duration}分钟 | 力度：${intensityMap[d.intensity] || '中'}`;
  }
  if (item.type === 'custom') {
    return `${d.value || ''}` + (d.sets ? ` × ${d.sets}组` : "");
  }
  return "";
}

// 从历史进入编辑：切到打卡页，用原记录填充参数界面
function editWorkout(id) {
  const w = state.workouts.find(x => x.id === id);
  if (!w) return;
  switchTab('log');
  openLogForm(w.type, w);
}

function renderHistory() {
  const container = document.getElementById("history-list-container");
  if (!container) return;
  
  const filterType = document.getElementById("filter-exercise-type").value;
  
  // 筛选记录
  let filtered = state.workouts;
  if (filterType !== "all") {
    filtered = filtered.filter(w => w.type === filterType);
  }
  
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-emoji">🧘‍♀️</div>
        <p>暂无相关健身记录，快去打卡吧！</p>
      </div>
    `;
    return;
  }
  
  // 按照日期分组
  const groups = {};
  filtered.forEach(w => {
    if (!groups[w.date]) groups[w.date] = [];
    groups[w.date].push(w);
  });
  
  // 排序日期 (最新的排在最前面)
  const sortedDates = Object.keys(groups).sort((a, b) => new Date(b) - new Date(a));
  
  let html = "";

  // 转换日期语义化 (如 今天 / 昨天)
  const todayStr = getLocalDateString();
  const yesterdayStr = getPastDateString(1);

  sortedDates.forEach(dateStr => {
    let dateDisplay = dateStr;
    const parts = dateStr.split('-');
    const formattedStr = `${parseInt(parts[1])}月${parseInt(parts[2])}日`;
    
    if (dateStr === todayStr) {
      dateDisplay = `今天 - ${formattedStr}`;
    } else if (dateStr === yesterdayStr) {
      dateDisplay = `昨天 - ${formattedStr}`;
    } else {
      dateDisplay = `${parts[0]}年${formattedStr}`;
    }
    
    html += `
      <div class="history-day-group">
        <div class="history-date-header">${dateDisplay}</div>
    `;
    
    groups[dateStr].forEach(item => {
      const meta = historyMeta(item);
      const icon = meta.icon;
      const title = meta.title;
      const stats = historyStatsText(item);

      html += `
        <div class="glass history-item-card">
          <div class="history-item-left">
            <div class="history-item-avatar">${icon}</div>
            <div class="history-item-details">
              <span class="history-item-title">${title}</span>
              <span class="history-item-stats">${stats}</span>
              ${item.notes ? `<span class="history-item-note">💬 ${item.notes}</span>` : ''}
            </div>
          </div>
          <div class="history-item-right">
            <button class="edit-btn" onclick="editWorkout('${item.id}')" title="编辑记录">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="delete-btn" onclick="deleteWorkout('${item.id}')" title="删除记录">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>
      `;
    });
    
    html += `</div>`;
  });
  
  container.innerHTML = html;
}

// ==========================================================================
// 7. AI 健身教练逻辑 (AI Coach integration with Gemini)
// ==========================================================================

// 将健身数据打包转换为面向大语言模型的精美 Markdown 提示词 (免 Key/直连通用)
// 把最近一次身体数据（体重/臂围/腰围/胸围）拼成一行，供 AI 参考
function buildBodyMetricsPromptLine() {
  if (!state.measurements || state.measurements.length === 0) return "";
  const m = state.measurements[0];
  const parts = [];
  if (m.arm != null) parts.push(`臂围 ${m.arm}cm`);
  if (m.waist != null) parts.push(`腰围 ${m.waist}cm`);
  if (m.chest != null) parts.push(`胸围 ${m.chest}cm`);
  if (parts.length === 0) return "";
  return `- 最近体测 (${m.date}): ${parts.join('，')}\n`;
}

function shouldFocusOnToday(userText, mode) {
  // 「今天 / 今日 / 本次 / 刚刚」只应分析当天日志，避免旧记录在回答里喧宾夺主。
  return mode === 'analysis' && /今天|今日|当天|本次|刚才|刚刚/.test(userText || '');
}

function getWorkoutPromptRecords({ focusToday = false } = {}) {
  const today = getLocalDateString();
  const sorted = [...state.workouts].sort((a, b) => {
    const dateCompare = String(b.date).localeCompare(String(a.date));
    if (dateCompare !== 0) return dateCompare;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
  return focusToday ? sorted.filter(w => w.date === today) : sorted.slice(0, 30);
}

function generateWorkoutSummaryPrompt({ focusToday = false } = {}) {
  const weight = state.settings.weight || 70;
  const recentWorkouts = getWorkoutPromptRecords({ focusToday });

  const equipmentListStr = EQUIPMENT_ROSTER.map(e => `- ${e.label}：${e.note}`).join("\n");

  let prompt = `你是一位专业且充满亲和力的 ChocoZAP 健身私人教练。请为我分析我最近的运动成果并提供针对性建议。

【重要限制：ChocoZAP 门店实际可用的器材清单】
${equipmentListStr}

请严格注意：你所有的训练建议、动作推荐，必须只从上面这份器材清单里选择。ChocoZAP 是一家小型 24 小时便利健身房，没有杠铃深蹲架、龙门架、壶铃、单杠等常见大型健身房器械，所以请不要提及或推荐清单之外的动作和器材。如果某个训练目标（比如练背、练腿弯举）在清单里没有直接对应的器材，请从清单中挑选功能最相近的替代动作，并说明这是替代方案。

另外请注意：ChocoZAP 的力量训练器械（腿举、肩推、胸推、牧师椅、高位下拉）配重片只能以 5kg 为最小单位调整，不支持 2.5kg 这种半档，所以你给出的所有重量建议必须是 5 的整数倍（如 20kg、25kg、30kg），不要出现 2.5kg 的倍数。

重要：本 App 的力量打卡支持"同一天同项目多重量组"，一条记录可以包含多个不同重量的组（例如高位下拉 25kg×12×3 组，再加 30kg×8×2 组）。请在给出训练菜单时，充分利用这种多重量组结构（比如金字塔递增/递减、递减组）。有氧（跑步机/单车）支持"变速"模式，可分为热身段、若干变速段（不同速度各自间隔时长）、冲刺段，请在需要时给出分段配速建议。

【我的个人档案】
- 体重: ${weight} kg
${buildBodyMetricsPromptLine()}
【本次分析的数据范围】
${focusToday ? `仅限今天（${getLocalDateString()}）的训练记录。不要把之前日期的打卡混进「今天的训练分析」；若今天没有记录，要直接说明。` : '最近 30 条训练记录（最新排在最前）。'}

【训练打卡记录】
`;

  if (recentWorkouts.length === 0) {
    prompt += "（尚无记录。我刚刚开始在 ChocoZAP 健身，请指导我如何入门并分配力量与有氧运动）\n";
  } else {
    recentWorkouts.forEach((w, index) => {
      const typeStr = {
        leg_press: "腿举 (力量)",
        shoulder_press: "肩推 (力量)",
        chest_press: "胸推 (力量)",
        preacher_curl: "牧师椅二头弯举 (力量)",
        lat_pulldown: "高位下拉 (力量)",
        situps: "仰卧起坐 (核心)",
        spin_bike: "动感单车 (有氧)",
        treadmill: "跑步机 (有氧)",
        massage_chair: "按摩椅放松 (拉伸)",
        custom: "自定义项目"
      }[w.type] || "其他";

      let detailsStr = "";
      if (WEIGHTED_STRENGTH.includes(w.type)) {
        detailsStr = getStrengthGroups(w.details).map(g => `${g.weight}kg x ${g.reps}次 x ${g.sets}组` + (g.extraReps ? `(+组外${g.extraReps}次)` : "")).join("；");
      } else if (w.type === 'situps') {
        detailsStr = `${w.details.reps}次 x ${w.details.sets}组` + (w.details.extraReps ? ` + 组外${w.details.extraReps}次` : "");
      } else if (w.type === 'spin_bike') {
        detailsStr = w.details.variableSpeed
          ? `变速骑行，总 ${w.details.time}分钟：${formatVariableSummary(w.details, '档')}`
          : `阻力 ${w.details.resistance}档，骑行 ${w.details.time}分钟`;
      } else if (w.type === 'treadmill') {
        detailsStr = w.details.variableSpeed
          ? `变速跑，总 ${w.details.time}分钟，坡度 ${w.details.incline || 0}%，预估距离 ${w.details.distance}km，预估消耗 ${w.details.calories}kcal：${formatVariableSummary(w.details, 'km/h')}`
          : `${w.details.mode === "walk" ? "快走" : "慢跑"}，时长 ${w.details.time}分钟，速度 ${w.details.speed}km/h，坡度 ${w.details.incline}%, 预估距离 ${w.details.distance}km, 预估消耗 ${w.details.calories}kcal`;
      } else if (w.type === 'massage_chair') {
        detailsStr = `模式 [${w.details.mode}]，放松 ${w.details.duration}分钟，力度级别 ${w.details.intensity}`;
      } else if (w.type === 'custom') {
        detailsStr = `[${w.details.name}] - 数据: ${w.details.value}` + (w.details.sets ? ` x ${w.details.sets}组` : "");
      }

      prompt += `${index + 1}. 日期: ${w.date} | 项目: ${typeStr} | 运动详情: ${detailsStr} ${w.notes ? `| 个人备注: "${w.notes}"` : ""}\n`;
    });
  }

  prompt += focusToday ? `
请只依据「今天」的记录回答本轮提问。先给今天训练的结论，再说是否适合补练、休息或做轻有氧；不要复述、更不要比较之前日期的记录。`
    : `
请结合近期记录回答本轮提问；需要比较趋势时，明确指出使用了哪些日期的数据。`;

  prompt += `\n回答要直接、具体、不过度承诺；涉及疼痛、受伤或明显不适时，建议停止加练并咨询专业人士。`;

  return prompt;
}

// ==========================================================================
// 7.1 "Gemini的推荐" 首页模块：解析 AI 结构化训练计划、渲染、完成/拒绝
// ==========================================================================

// 只有直连 API 模式才能拿到可解析的回复，这里教会 AI 在"给出具体训练菜单推荐"时，
// 在人类可读的回复末尾追加一段机器可读的 JSON 计划块，方便一键转为打卡记录
function buildStructuredPlanInstruction() {
  return `
【结构化训练计划输出格式 —— 本次请求就是在向你要一份具体可执行的训练菜单，必须输出】
请在你正常的、给人看的回复内容结束之后，另起一行，追加一个由 <!--CHOCOZAP_PLAN_START--> 和 <!--CHOCOZAP_PLAN_END--> 包裹的 JSON 数组，
数组每一项代表一个推荐动作，格式为：
{ "type": "器材英文标识", "label": "中文名称", "intensity": "给人看的强度描述文字", "details": { ...结构化数值字段 } }
type 必须是以下英文标识之一，details 字段必须严格匹配对应 schema：
  - 力量项目 "leg_press" / "shoulder_press" / "chest_press" / "preacher_curl" / "lat_pulldown"：
      details = { "groups": [ { "weight": 数字(必须为5的整数倍), "reps": 数字, "sets": 数字, "extraReps": 数字或0 }, ... ] }
      （groups 数组支持"多重量组"——如需金字塔/递减组，就放多组不同 weight；只做一组也要用 groups 包一个元素）
  - "situps"：details = { "reps": 数字, "sets": 数字, "extraReps": 数字或0 }
  - "spin_bike"：details = { "resistance": 数字1-24, "time": 分钟数 }
  - "treadmill"：details = { "mode": "walk" 或 "run", "speed": km/h数字, "incline": 坡度数字, "time": 分钟数 }
  - "massage_chair"：details = { "mode": 字符串, "duration": 分钟数, "intensity": 1/2/3 }
如果推荐的动作不在上述器材范围内，type 请填 "custom"，details 填 { "name": "动作名称", "value": "关键数据文字", "sets": 组数或null }。
这段 JSON 是给 App 自动解析用的，不需要在正文里重复解释它，也不要用 Markdown 代码块包裹，直接是纯 JSON 数组文本，且这次务必要输出。`;
}

// 从 AI 回复文本中提取结构化训练计划 JSON 块，返回清理后的正文 + 计划数组
function extractAiPlanFromReply(text) {
  const match = text.match(/<!--CHOCOZAP_PLAN_START-->([\s\S]*?)<!--CHOCOZAP_PLAN_END-->/);
  if (!match) return { cleanedText: text, items: [] };

  const cleanedText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  let items = [];
  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed)) items = parsed;
  } catch (e) {
    items = [];
  }
  return { cleanedText, items };
}

// 身体分析模式的结构化输出指令。稳定性设计三管齐下：
// 1. temperature 0 (调用处设置)
// 2. 把 App 自己算出的恢复估算值作为"锚点"提供给 AI，只允许小幅修正而不是从零发挥
// 3. 数值强制取整为 5 的倍数、点评限制字数，压缩自由发挥空间
function buildRecoveryAnalysisInstruction() {
  const algoValues = computeRecoveryStatus();
  const algoStr = Object.keys(algoValues).map(part => `  - ${part}: ${algoValues[part]}%`).join('\n');
  const partsListStr = Object.keys(RECOVERY_HOURS).join('、');

  return `
【身体部位恢复分析输出格式 —— 本次请求需要输出结构化的恢复分析数据，必须输出】
App 已按训练量和间隔时间算出了各部位当前的恢复度估算值（100% = 完全恢复）：
${algoStr}
请以这些估算值为基准进行分析。你只在有明确依据时（比如用户备注了酸痛、某部位连续多日高强度训练、训练量异常）
对个别部位做 ±15% 以内的修正，其余部位直接沿用估算值。所有恢复度数值必须是 5 的整数倍。
非常重要：你的输出必须是确定性的——同样的输入数据必须给出完全相同的数值和点评，不要引入任何随机变化。

请在你正常的、给人看的回复内容结束之后，另起一行，追加一个由 <!--CHOCOZAP_RECOVERY_START--> 和 <!--CHOCOZAP_RECOVERY_END--> 包裹的 JSON 对象，格式为：
{ "summary": "不超过50字的总体训练建议", "parts": [ { "part": "部位名", "recovery": 数值0-100, "comment": "不超过30字的该部位点评" }, ... ] }
part 必须是以下名称之一（每个部位最多出现一次）：${partsListStr}
这段 JSON 是给 App 自动解析用的，不要用 Markdown 代码块包裹，直接是纯 JSON 文本，且这次务必要输出。`;
}

// 从 AI 回复文本中提取结构化恢复分析块，返回清理后的正文 + 校验过的恢复数据 (无效时为 null)
function extractAiRecoveryFromReply(text) {
  const match = text.match(/<!--CHOCOZAP_RECOVERY_START-->([\s\S]*?)<!--CHOCOZAP_RECOVERY_END-->/);
  if (!match) return { cleanedText: text, recovery: null };

  const cleanedText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  let recovery = null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.parts)) {
      const validParts = parsed.parts
        .filter(p => p && RECOVERY_HOURS[p.part] !== undefined && typeof p.recovery === 'number')
        .map(p => ({
          part: p.part,
          recovery: Math.max(0, Math.min(100, Math.round(p.recovery / 5) * 5)),
          comment: typeof p.comment === 'string' ? p.comment.slice(0, 60) : ''
        }));
      // 同一部位出现多次时保留第一次
      const seen = new Set();
      const dedupedParts = validParts.filter(p => !seen.has(p.part) && seen.add(p.part));
      if (dedupedParts.length > 0) {
        recovery = {
          summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 100) : '',
          parts: dedupedParts
        };
      }
    }
  } catch (e) {
    recovery = null;
  }
  return { cleanedText, recovery };
}

// 保存 AI 恢复分析结果并刷新趋势板块的恢复进度模块
function applyAiRecoveryAnalysis(recovery) {
  localStorage.setItem("chocozap_recovery_ai", JSON.stringify({
    updatedAt: Date.now(),
    workoutFingerprint: getRecoveryInputFingerprint(),
    summary: recovery.summary,
    parts: recovery.parts
  }));
  renderRecoveryStatus();
}

// 把 AI 给出的原始计划条目校验/归一化后加入推荐列表并持久化
function addAiRecommendations(rawItems) {
  const now = Date.now();
  const added = rawItems.map((item, idx) => ({
    id: "rec-" + now + "-" + idx + "-" + Math.random().toString(36).slice(2, 6),
    type: typeof item.type === 'string' ? item.type : 'custom',
    label: typeof item.label === 'string' && item.label ? item.label : '训练推荐',
    intensity: typeof item.intensity === 'string' ? item.intensity : '',
    details: (item.details && typeof item.details === 'object') ? item.details : null,
    createdAt: now
  })).filter(item => item.label);

  if (added.length === 0) return;

  state.aiRecommendations = state.aiRecommendations.concat(added);
  localStorage.setItem("chocozap_ai_recommendations", JSON.stringify(state.aiRecommendations));
  renderAiRecommendations();
}

// 渲染首页"Gemini的推荐"模块；没有待处理推荐时整个模块隐藏，避免占用首页空间
function renderAiRecommendations() {
  const section = document.getElementById("ai-recommendation-section");
  const list = document.getElementById("ai-recommendation-list");
  if (!section || !list) return;

  if (!state.aiRecommendations || state.aiRecommendations.length === 0) {
    section.style.display = "none";
    list.innerHTML = ""; // 清空残留节点，避免隐藏后 DOM 里仍留着旧的推荐卡片
    return;
  }
  section.style.display = "block";

  const iconMap = {
    leg_press: "🦵", shoulder_press: "💪", chest_press: "🏋️", preacher_curl: "🧘", lat_pulldown: "🔽",
    situps: "🧗", spin_bike: "🚴", treadmill: "🏃", massage_chair: "💆", custom: "⚙️"
  };

  list.innerHTML = state.aiRecommendations.map(rec => `
    <div class="glass ai-rec-item">
      <div class="ai-rec-left">
        <div class="ai-rec-avatar">${iconMap[rec.type] || "⚙️"}</div>
        <div class="ai-rec-details">
          <span class="ai-rec-title">${rec.label}</span>
          ${rec.intensity ? `<span class="ai-rec-intensity">${rec.intensity}</span>` : ''}
        </div>
      </div>
      <div class="ai-rec-actions">
        <button class="ai-rec-btn ai-rec-accept" onclick="acceptAiRecommendation('${rec.id}')" title="完成并打卡">✓ 完成</button>
        <button class="ai-rec-btn ai-rec-adjust" onclick="openAdjustRecDialog('${rec.id}')" title="调整强度/组数后再完成">✎ 调整</button>
        <button class="ai-rec-btn ai-rec-reject" onclick="rejectAiRecommendation('${rec.id}')" title="不需要这条推荐">✕ 拒绝</button>
      </div>
    </div>
  `).join('');
}

// ==========================================================================
// 7.3 调整 AI 推荐：完成前允许修改强度(重量)/组数/组外次数等参数
// ==========================================================================
let adjustingRecId = null;

// 力量类项目 (含重量) 统一走这一套字段；ChocoZAP 配重只能以 5kg 为单位，
// 所以这里的步进器只给 ±5，不提供 ±1，从 UI 层面就避免调出不合法的重量
function buildStrengthAdjustFields(d) {
  // 兼容多重量组：调整对话框以第一组为基准编辑（落地时按单组处理）
  const g0 = getStrengthGroups(d)[0] || { weight: WEIGHT_STEP_KG, reps: 12, sets: 3, extraReps: 0 };
  const weight = roundToNearestStep(g0.weight, WEIGHT_STEP_KG) || WEIGHT_STEP_KG;
  return `
    ${(getStrengthGroups(d).length > 1) ? '<p class="settings-desc" style="margin-bottom:8px;">该推荐含多个重量组，这里以首组为准调整；如需保留多组请直接「完成」后在历史里编辑。</p>' : ''}
    <div class="form-row">
      <label>重量 (kg) <small>—— ChocoZAP 器械以 5kg 为单位调整</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-weight', -${WEIGHT_STEP_KG})">-5</button>
        <input type="number" id="adjust-weight" value="${weight}" min="0" max="300" step="${WEIGHT_STEP_KG}">
        <button type="button" class="step-btn increase" onclick="adjustValue('adjust-weight', ${WEIGHT_STEP_KG})">+5</button>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>每组次数</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-reps', -1)">-</button>
          <input type="number" id="adjust-reps" value="${g0.reps || 12}" min="1" max="100">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-reps', 1)">+</button>
        </div>
      </div>
      <div class="form-row">
        <label>组数</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sets', -1)">-</button>
          <input type="number" id="adjust-sets" value="${g0.sets || 3}" min="1" max="20">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-sets', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>组外次数 <small>—— 可选，正式组数之外力竭/额外加练的次数</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-extra-reps', -1)">-</button>
        <input type="number" id="adjust-extra-reps" value="${d.extraReps || ''}" placeholder="0" min="0" max="100">
        <button type="button" class="step-btn increase" onclick="adjustValue('adjust-extra-reps', 1)">+</button>
      </div>
    </div>
  `;
}

function buildSitupsAdjustFields(d) {
  return `
    <div class="form-row-grid">
      <div class="form-row">
        <label>每组次数</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-reps', -5)">-5</button>
          <input type="number" id="adjust-reps" value="${d.reps || 15}" min="1" max="200">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-reps', 5)">+5</button>
        </div>
      </div>
      <div class="form-row">
        <label>组数</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sets', -1)">-</button>
          <input type="number" id="adjust-sets" value="${d.sets || 3}" min="1" max="20">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-sets', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>组外次数 <small>—— 可选</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-extra-reps', -1)">-</button>
        <input type="number" id="adjust-extra-reps" value="${d.extraReps || ''}" placeholder="0" min="0" max="200">
        <button type="button" class="step-btn increase" onclick="adjustValue('adjust-extra-reps', 1)">+</button>
      </div>
    </div>
  `;
}

function buildSpinBikeAdjustFields(d) {
  return `
    <div class="form-row-grid">
      <div class="form-row">
        <label>阻力档位 (1-24)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-resistance', -1)">-</button>
          <input type="number" id="adjust-resistance" value="${d.resistance || 8}" min="1" max="24">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-resistance', 1)">+</button>
        </div>
      </div>
      <div class="form-row">
        <label>骑行时长 (分钟)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-time', -5)">-5</button>
          <input type="number" id="adjust-time" value="${d.time || 20}" min="1" max="180">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-time', 5)">+5</button>
        </div>
      </div>
    </div>
  `;
}

function buildTreadmillAdjustFields(d) {
  const mode = d.mode === 'run' ? 'run' : 'walk';
  return `
    <div class="form-row">
      <label>运动类型</label>
      <div class="segmented-control">
        <label class="segment-item">
          <input type="radio" name="adjust-treadmill-mode" value="walk" ${mode === 'walk' ? 'checked' : ''}>
          <span>🚶 快走</span>
        </label>
        <label class="segment-item">
          <input type="radio" name="adjust-treadmill-mode" value="run" ${mode === 'run' ? 'checked' : ''}>
          <span>🏃 跑步</span>
        </label>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>速度 (km/h)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-speed', -0.5)">-</button>
          <input type="number" id="adjust-speed" value="${d.speed || 6}" min="2" max="20" step="0.5">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-speed', 0.5)">+</button>
        </div>
      </div>
      <div class="form-row">
        <label>坡度 (%)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-incline', -1)">-</button>
          <input type="number" id="adjust-incline" value="${d.incline || 0}" min="0" max="15">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-incline', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>时长 (分钟)</label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-time', -5)">-5</button>
        <input type="number" id="adjust-time" value="${d.time || 30}" min="1" max="180">
        <button type="button" class="step-btn increase" onclick="adjustValue('adjust-time', 5)">+5</button>
      </div>
    </div>
  `;
}

function buildMassageChairAdjustFields(d) {
  return `
    <div class="form-row">
      <label>按摩模式</label>
      <input type="text" id="adjust-massage-mode" value="${d.mode || '自动舒缓'}" class="glass-input">
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>按摩时长 (分钟)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-duration', -15)">-15</button>
          <input type="number" id="adjust-duration" value="${d.duration || 30}" min="15" max="120">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-duration', 15)">+15</button>
        </div>
      </div>
      <div class="form-row">
        <label>强度级别 (1弱 / 2中 / 3强)</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-intensity', -1)">-</button>
          <input type="number" id="adjust-intensity" value="${d.intensity || 2}" min="1" max="3">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-intensity', 1)">+</button>
        </div>
      </div>
    </div>
  `;
}

function buildCustomAdjustFields(rec, d) {
  return `
    <div class="form-row">
      <label>项目名称</label>
      <input type="text" id="adjust-custom-name" value="${rec.label || ''}" class="glass-input">
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>关键数据 (如重量/次数)</label>
        <input type="text" id="adjust-custom-value" value="${(d && d.value) || rec.intensity || ''}" class="glass-input">
      </div>
      <div class="form-row">
        <label>组数 (非必填)</label>
        <input type="number" id="adjust-custom-sets" value="${(d && d.sets) || ''}" class="glass-input" min="1">
      </div>
    </div>
  `;
}

// 打开"调整"弹窗，根据推荐项目的类型动态渲染对应的可编辑字段
function openAdjustRecDialog(id) {
  const rec = state.aiRecommendations.find(r => r.id === id);
  if (!rec) return;

  adjustingRecId = id;
  const d = rec.details && typeof rec.details === 'object' ? rec.details : {};
  const fieldsContainer = document.getElementById("adjust-rec-fields");

  const strengthTypes = ['leg_press', 'shoulder_press', 'chest_press', 'preacher_curl', 'lat_pulldown'];
  if (strengthTypes.includes(rec.type)) {
    fieldsContainer.innerHTML = buildStrengthAdjustFields(d);
  } else if (rec.type === 'situps') {
    fieldsContainer.innerHTML = buildSitupsAdjustFields(d);
  } else if (rec.type === 'spin_bike') {
    fieldsContainer.innerHTML = buildSpinBikeAdjustFields(d);
  } else if (rec.type === 'treadmill') {
    fieldsContainer.innerHTML = buildTreadmillAdjustFields(d);
  } else if (rec.type === 'massage_chair') {
    fieldsContainer.innerHTML = buildMassageChairAdjustFields(d);
  } else {
    fieldsContainer.innerHTML = buildCustomAdjustFields(rec, d);
  }

  document.getElementById("adjust-rec-dialog-title").textContent = `调整推荐：${rec.label}`;
  document.getElementById("adjust-rec-dialog").style.display = "flex";
}

function closeAdjustRecDialog() {
  document.getElementById("adjust-rec-dialog").style.display = "none";
  adjustingRecId = null;
}

// 保存调整：根据当前弹窗里的字段读值，更新该条推荐的 details，并重新生成强度展示文字
function saveAdjustedRecommendation() {
  const rec = state.aiRecommendations.find(r => r.id === adjustingRecId);
  if (!rec) { closeAdjustRecDialog(); return; }

  const strengthTypes = ['leg_press', 'shoulder_press', 'chest_press', 'preacher_curl', 'lat_pulldown'];

  if (strengthTypes.includes(rec.type)) {
    const weight = roundToNearestStep(document.getElementById("adjust-weight").value, WEIGHT_STEP_KG);
    const reps = parseInt(document.getElementById("adjust-reps").value) || 0;
    const sets = parseInt(document.getElementById("adjust-sets").value) || 0;
    const extraReps = parseInt(document.getElementById("adjust-extra-reps").value) || 0;
    rec.details = { weight, reps, sets, extraReps };
    rec.intensity = `${weight}kg x ${reps}次 x ${sets}组` + (extraReps ? ` + 组外${extraReps}次` : "");
  } else if (rec.type === 'situps') {
    const reps = parseInt(document.getElementById("adjust-reps").value) || 0;
    const sets = parseInt(document.getElementById("adjust-sets").value) || 0;
    const extraReps = parseInt(document.getElementById("adjust-extra-reps").value) || 0;
    rec.details = { reps, sets, extraReps };
    rec.intensity = `${reps}次 x ${sets}组` + (extraReps ? ` + 组外${extraReps}次` : "");
  } else if (rec.type === 'spin_bike') {
    const resistance = parseInt(document.getElementById("adjust-resistance").value) || 0;
    const time = parseInt(document.getElementById("adjust-time").value) || 0;
    rec.details = { resistance, time };
    rec.intensity = `阻力${resistance}档，骑行${time}分钟`;
  } else if (rec.type === 'treadmill') {
    const mode = document.querySelector('input[name="adjust-treadmill-mode"]:checked').value;
    const speed = parseFloat(document.getElementById("adjust-speed").value) || 0;
    const incline = parseFloat(document.getElementById("adjust-incline").value) || 0;
    const time = parseInt(document.getElementById("adjust-time").value) || 0;
    rec.details = { mode, speed, incline, time };
    rec.intensity = `${mode === 'walk' ? '快走' : '慢跑'} ${time}分钟，速度${speed}km/h，坡度${incline}%`;
  } else if (rec.type === 'massage_chair') {
    const mode = document.getElementById("adjust-massage-mode").value.trim() || '自动舒缓';
    const duration = parseInt(document.getElementById("adjust-duration").value) || 30;
    const intensity = parseInt(document.getElementById("adjust-intensity").value) || 2;
    rec.details = { mode, duration, intensity };
    rec.intensity = `${mode}，${duration}分钟，强度${intensity}`;
  } else {
    const name = document.getElementById("adjust-custom-name").value.trim() || rec.label;
    const value = document.getElementById("adjust-custom-value").value.trim();
    const sets = parseInt(document.getElementById("adjust-custom-sets").value) || null;
    rec.label = name;
    rec.details = { name, value, sets };
    rec.intensity = value + (sets ? ` x ${sets}组` : "");
  }

  localStorage.setItem("chocozap_ai_recommendations", JSON.stringify(state.aiRecommendations));
  closeAdjustRecDialog();
  renderAiRecommendations();

  if (state.settings.githubToken) {
    syncWithGithub(true);
  }
}

// 点击"完成"：把推荐条目落地为一条今天的真实打卡记录
function acceptAiRecommendation(id) {
  const rec = state.aiRecommendations.find(r => r.id === id);
  if (!rec) return;

  const knownTypes = Object.keys(WORKOUT_REQUIRED_FIELDS);
  let type = knownTypes.includes(rec.type) ? rec.type : 'custom';
  let details = rec.details && typeof rec.details === 'object' ? { ...rec.details } : null;

  // 力量项目：兼容 AI 给出 groups 数组或旧的扁平 weight/reps/sets；重量强制取整到 5kg
  if (WEIGHTED_STRENGTH.includes(type)) {
    const groups = getStrengthGroups(details || {})
      .filter(g => g.reps > 0 && g.sets > 0)
      .map(g => ({ weight: roundToNearestStep(g.weight, WEIGHT_STEP_KG), reps: g.reps, sets: g.sets, extraReps: g.extraReps || 0 }));
    if (groups.length === 0) {
      type = 'custom';
    } else {
      details = { groups: groups };
    }
  } else if (type !== 'custom') {
    // 其他已知类型：校验必填数值字段
    const requiredFields = WORKOUT_REQUIRED_FIELDS[type];
    const valid = details && requiredFields.every(f => details[f] !== undefined && details[f] !== null && details[f] !== '');
    if (!valid) type = 'custom';
  }

  if (type === 'custom') {
    details = {
      name: rec.label || '自定义项目',
      value: rec.intensity || '',
      sets: (details && details.sets) || null
    };
  } else if (type === 'treadmill') {
    // 距离/卡路里统一由 App 按同一套公式计算，不采信 AI 自行估算的数值，保证口径一致
    const est = computeTreadmillEstimate(details.mode, details.speed, details.incline, details.time);
    details.distance = est.distance;
    details.calories = est.calories;
  }

  const newWorkout = {
    id: "workout-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    date: getLocalDateString(),
    type: type,
    details: details,
    notes: "来自 " + getAiCoachName() + " 推荐" + (rec.intensity ? `：${rec.intensity}` : "")
  };

  state.workouts.unshift(newWorkout);
  localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));

  // 检查这条完成的 AI 推荐是否刷新了 PR
  checkAndCelebratePR(newWorkout);

  removeAiRecommendation(id);

  if (state.settings.githubToken) {
    syncWithGithub(true);
  }

  renderAiRecommendations();
  updateStats();
  renderHistory();
}

// 点击"拒绝"：仅从推荐列表移除，不产生任何打卡记录
function rejectAiRecommendation(id) {
  removeAiRecommendation(id);
  renderAiRecommendations();

  // 拒绝也要同步到云端，否则另一台设备还是会看到这条已经被拒绝的推荐
  if (state.settings.githubToken) {
    syncWithGithub(true);
  }
}

// 把一条推荐从待处理列表移除，并写入墓碑——
// 推荐条目也会参与云同步，如果不打墓碑，云端旧数据合并回来时会让已完成/已拒绝的推荐"复活"
// (跟打卡记录删除时是同一套机制，两者的 id 前缀不同，可以安全共用同一张墓碑表)
function removeAiRecommendation(id) {
  state.aiRecommendations = state.aiRecommendations.filter(r => r.id !== id);
  state.deletedIds[id] = Date.now();
  localStorage.setItem("chocozap_ai_recommendations", JSON.stringify(state.aiRecommendations));
  localStorage.setItem("chocozap_deleted", JSON.stringify(state.deletedIds));
}

// 生成新一轮训练菜单时，替换掉所有尚未处理的旧推荐（而不是无限堆积）。
// 被替换掉的旧条目也要打墓碑，避免云端合并时被旧数据带回来
function setAiRecommendations(rawItems) {
  const now = Date.now();
  state.aiRecommendations.forEach(rec => { state.deletedIds[rec.id] = now; });
  localStorage.setItem("chocozap_deleted", JSON.stringify(state.deletedIds));

  state.aiRecommendations = [];
  addAiRecommendations(rawItems);
}

// 模式 B: 一键生成 Prompt 并弹出弹窗供用户复制
function packageWorkoutDataPrompt() {
  const prompt = generateWorkoutSummaryPrompt();
  
  document.getElementById("prompt-content-text").value = prompt;
  document.getElementById("prompt-dialog").style.display = "flex";
}

function closePromptDialog() {
  document.getElementById("prompt-dialog").style.display = "none";
}

function copyPromptText() {
  const textarea = document.getElementById("prompt-content-text");
  textarea.select();
  textarea.setSelectionRange(0, 99999); // 适配移动端
  
  try {
    navigator.clipboard.writeText(textarea.value).then(() => {
      alert("复制成功！可以直接粘贴给网页版 Gemini / ChatGPT 了。");
      closePromptDialog();
    });
  } catch (err) {
    // 兼容性降级处理
    document.execCommand("copy");
    alert("复制成功！(降级通道)");
    closePromptDialog();
  }
}

// ==========================================================================
// 7.2 AI 多会话聊天记录 (Chat Sessions，仿主流 AI 聊天 App 的历史对话)
//     三种聊天模式：聊天(chat) / 训练菜单(menu) / 身体分析(analysis)
// ==========================================================================
// 注意：欢迎语会经过 formatChatMessageText 处理 (先转义 HTML 再解析 **粗体**/换行)，
// 所以只能写 Markdown 语法，不能直接写 <strong>/<br> 这类 HTML 标签，否则会被转义显示成字面文字
const AI_MODES = {
  chat: {
    label: '💬 聊天',
    placeholder: "输入你想问的问题，如：'分析我最近的腿举重量是否有进步？'",
    quickAction: '打包健身数据',
    welcome: `你好！我是你的 AI 健身教练。这里是**自由聊天模式**，你可以随便问我训练、饮食、恢复相关的问题，我会结合你的打卡历史来回答。

**💡 提示：**
1. 需要 AI 定制可一键打卡的训练菜单？返回上一级选择「训练菜单」模式
2. 想了解各部位的疲劳与恢复状况？选择「身体分析」模式
3. 没有配置 API Key 也可以点击下方「打包健身数据」，复制 Prompt 粘贴到任意 AI 网页端使用`
  },
  menu: {
    label: '📋 训练菜单',
    placeholder: "描述你的需求，如：'今天想练腿和核心，时间只有40分钟'",
    quickAction: '一键生成今日菜单',
    welcome: `这里是**训练菜单模式**。直接告诉我你今天的目标、状态或时间限制，我会给出一份具体可执行的训练菜单，并自动推送到主页的「AI 教练推荐」模块，可以一键打卡。

也可以点击下方「一键生成今日菜单」，我会根据你的训练历史和恢复状况直接安排。

注意：新生成的菜单会替换掉主页上还没处理完的旧推荐。`
  },
  analysis: {
    label: '🩺 身体分析',
    placeholder: "可以直接提问，如：'我这周练得均衡吗？明天适合练什么？'",
    quickAction: '一键分析恢复状况',
    welcome: `这里是**身体分析模式**。我会基于你近期的打卡数据，分析各身体部位的训练量分布与疲劳恢复状况。

点击下方「一键分析恢复状况」，分析结果会自动推送到「趋势」板块的恢复进度模块（覆盖算法估算值，并附上我的点评）。`
  }
};

// 当前所处的聊天模式；null = 显示模式选择首页
let currentAiMode = null;

function getSessionMode(session) {
  return session.mode || 'chat'; // 旧版会话没有 mode 字段，一律视为普通聊天
}

// 进入某个聊天模式：恢复该模式最近的会话（没有则新建），并切换 UI
function enterAiMode(mode) {
  if (!AI_MODES[mode]) return;
  currentAiMode = mode;

  // 延续上次的对话：优先保留当前激活的会话（用户可能刷新前刚手动切换过去），
  // 其次取该模式下最近更新的会话，都没有才新建
  const activeSession = state.chatSessions.find(s => s.id === state.activeChatSessionId);
  const sessionsOfMode = state.chatSessions.filter(s => getSessionMode(s) === mode);
  if (activeSession && getSessionMode(activeSession) === mode) {
    // 当前激活的会话就属于这个模式，直接沿用
  } else if (sessionsOfMode.length > 0) {
    sessionsOfMode.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    state.activeChatSessionId = sessionsOfMode[0].id;
  } else {
    const session = { id: "chat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), mode: mode, messages: [], updatedAt: Date.now() };
    state.chatSessions.unshift(session);
    state.activeChatSessionId = session.id;
  }
  persistChatSessions();

  document.getElementById("ai-mode-home").style.display = "none";
  document.getElementById("ai-chat-wrapper").style.display = "flex";
  syncAiModeUI();
  renderChatSessionMessages();
  renderChatHistoryList();
}

// 返回模式选择首页
function exitAiMode() {
  currentAiMode = null;
  closeChatHistoryPanel();
  document.getElementById("ai-chat-wrapper").style.display = "none";
  document.getElementById("ai-mode-home").style.display = "flex";
}

// 同步模式徽标 / 输入框占位文字 / 快捷按钮文案
function syncAiModeUI() {
  const conf = AI_MODES[currentAiMode] || AI_MODES.chat;
  const badge = document.getElementById("ai-mode-badge");
  if (badge) badge.textContent = conf.label;
  const input = document.getElementById("chat-input");
  if (input) input.placeholder = conf.placeholder;
  const quickBtn = document.getElementById("ai-quick-action");
  if (quickBtn) quickBtn.textContent = conf.quickAction;
}

// 快捷按钮：按当前模式分发
function runAiQuickAction() {
  if (currentAiMode === 'menu') {
    requestTrainingPlan();
  } else if (currentAiMode === 'analysis') {
    requestBodyAnalysis();
  } else {
    packageWorkoutDataPrompt();
  }
}

function persistChatSessions() {
  localStorage.setItem("chocozap_chat_sessions", JSON.stringify(state.chatSessions));
  localStorage.setItem("chocozap_active_chat_session", state.activeChatSessionId || "");
}

// 取得当前激活的会话，如果不存在（首次使用/被删空）则新建一个
function getActiveChatSession() {
  let session = state.chatSessions.find(s => s.id === state.activeChatSessionId);
  if (!session) {
    session = { id: "chat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), mode: currentAiMode || 'chat', messages: [], updatedAt: Date.now() };
    state.chatSessions.unshift(session);
    state.activeChatSessionId = session.id;
    persistChatSessions();
  }
  return session;
}

// 会话标题：取该会话第一条用户提问，截断展示；还没有提问时显示"新对话"
function getSessionTitle(session) {
  const firstUserMsg = session.messages.find(m => m.role === 'user');
  if (!firstUserMsg) return "新对话";
  const text = firstUserMsg.text.trim();
  return text.length > 16 ? text.slice(0, 16) + "…" : text;
}

function startNewChatSession() {
  const session = { id: "chat-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), mode: currentAiMode || 'chat', messages: [], updatedAt: Date.now() };
  state.chatSessions.unshift(session);
  state.activeChatSessionId = session.id;
  persistChatSessions();
  renderChatSessionMessages();
  renderChatHistoryList();
  closeChatHistoryPanel();
}

function switchChatSession(id) {
  if (state.activeChatSessionId === id) { closeChatHistoryPanel(); return; }
  const target = state.chatSessions.find(s => s.id === id);
  if (!target) return;

  state.activeChatSessionId = id;
  // 历史会话可能属于别的模式，跟随会话切换模式，保证上下文和系统指令匹配
  currentAiMode = getSessionMode(target);
  syncAiModeUI();
  persistChatSessions();
  renderChatSessionMessages();
  renderChatHistoryList();
  closeChatHistoryPanel();
}

function deleteChatSession(id, event) {
  if (event) event.stopPropagation(); // 防止触发外层的切换会话点击
  if (!confirm("确定要删除这段对话记录吗？此操作无法撤销。")) return;

  state.chatSessions = state.chatSessions.filter(s => s.id !== id);
  if (state.activeChatSessionId === id) {
    state.activeChatSessionId = state.chatSessions.length > 0 ? state.chatSessions[0].id : null;
  }
  persistChatSessions();
  renderChatSessionMessages();
  renderChatHistoryList();
}

function toggleChatHistoryPanel() {
  const panel = document.getElementById("chat-history-panel");
  if (!panel) return;
  panel.classList.toggle("open");
  if (panel.classList.contains("open")) renderChatHistoryList();
}

function closeChatHistoryPanel() {
  const panel = document.getElementById("chat-history-panel");
  if (panel) panel.classList.remove("open");
}

// 渲染左侧历史对话列表
function renderChatHistoryList() {
  const list = document.getElementById("chat-history-list");
  if (!list) return;

  if (state.chatSessions.length === 0) {
    list.innerHTML = `<div class="chat-history-empty">暂无历史对话，发送第一条消息后会自动生成～</div>`;
    return;
  }

  const sorted = [...state.chatSessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const modeBadges = { chat: '💬', menu: '📋', analysis: '🩺' };
  list.innerHTML = sorted.map(session => {
    const isActive = session.id === state.activeChatSessionId;
    const lastMsg = session.messages[session.messages.length - 1];
    const timeStr = lastMsg ? new Date(lastMsg.time || session.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
    return `
      <div class="chat-history-item ${isActive ? 'active' : ''}" onclick="switchChatSession('${session.id}')">
        <div class="chat-history-item-title">${modeBadges[getSessionMode(session)] || '💬'} ${getSessionTitle(session)}</div>
        <div class="chat-history-item-meta">
          <span>${timeStr}</span>
          <button class="chat-history-delete-btn" onclick="deleteChatSession('${session.id}', event)" title="删除">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

// 把当前激活会话的历史消息重新渲染进聊天窗口 (切换会话/刷新页面时调用)
function renderChatSessionMessages() {
  const container = document.getElementById("chat-messages-container");
  if (!container) return;
  container.innerHTML = "";

  const session = state.chatSessions.find(s => s.id === state.activeChatSessionId);
  if (!session || session.messages.length === 0) {
    const conf = AI_MODES[currentAiMode || (session ? getSessionMode(session) : 'chat')] || AI_MODES.chat;
    appendMessage("ai", getAiCoachName(), conf.welcome, false, false);
    return;
  }
  session.messages.forEach(m => {
    appendMessage(m.role, m.name, m.text, false, false);
  });
}

// 发送按钮：按当前所处的模式对话 (聊天=纯对话，菜单=可生成推荐，分析=可推送恢复数据)
async function sendChatMessage() {
  const chatInput = document.getElementById("chat-input");
  const userText = chatInput.value.trim();
  if (!userText) return;
  chatInput.value = "";

  await callAiCoach(userText, { mode: currentAiMode || 'chat' });
}

// "一键生成今日菜单"：训练菜单模式的快捷入口
async function requestTrainingPlan() {
  if (!getActiveApiKey()) {
    alert(`生成训练菜单需要先在"设置"页配置 ${AI_PROVIDERS[getAiProvider()].keyLabel}（免 Key 的"打包健身数据"模式无法自动生成推荐列表，只能手动复制文字）。`);
    switchTab('settings');
    return;
  }

  const userText = "请帮我安排一份今天可以在 ChocoZAP 完成的具体训练菜单，包含项目、重量、组数等可执行的强度安排。";
  await callAiCoach(userText, { mode: 'menu' });
}

// "一键分析恢复状况"：身体分析模式的快捷入口
async function requestBodyAnalysis() {
  if (!getActiveApiKey()) {
    alert(`身体分析需要先在"设置"页配置 ${AI_PROVIDERS[getAiProvider()].keyLabel}。`);
    switchTab('settings');
    return;
  }

  const userText = "请基于我的打卡数据，分析各身体部位的训练量分布和当前的疲劳恢复状况，并把结构化结果推送给 App。";
  await callAiCoach(userText, { mode: 'analysis' });
}

// 取当前提供方对应的 API Key
function getActiveApiKey() {
  const provider = getAiProvider();
  // Key 必须严格按提供方取用，不能把 Claude / Gemini 的 Key 误发给 OpenAI。
  // 旧版单一 apiKey 会在 loadData() 中迁移到 apiKeys[当前提供方]。
  return (state.settings.apiKeys && state.settings.apiKeys[provider]) || '';
}

// 直连 Anthropic Claude Messages API（浏览器端直连需带 anthropic-dangerous-direct-browser-access 头）
async function requestClaude(model, systemPromptText, messages, mode) {
  const claudeMessages = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text
  }));
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": getActiveApiKey(),
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 4096,
      system: systemPromptText,
      messages: claudeMessages
    })
  });
  const data = await response.json();
  if (!response.ok || data.type === 'error') {
    const msg = (data.error && data.error.message) || "请求 Claude 失败，请检查 API Key 是否有效。";
    throw new Error(msg);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error("Claude 出于安全策略拒绝了本次请求，请换一种问法。");
  }
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text || "").join("");
}

// 直连 OpenAI Responses API。为了与 Claude/Gemini 保持相同的无后端部署方式，Key 仅留在本机浏览器。
async function requestOpenAI(model, systemPromptText, messages, mode) {
  const input = [
    { role: 'developer', content: [{ type: 'input_text', text: systemPromptText }] },
    ...messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: [{ type: m.role === 'user' ? 'input_text' : 'output_text', text: m.text }]
    }))
  ];
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getActiveApiKey()}`
    },
    body: JSON.stringify({
      model,
      input,
      max_output_tokens: 4096,
      text: { verbosity: 'medium' },
      // 身体分析需要更稳定地遵守 JSON 输出；普通聊天优先降低等待与费用。
      reasoning: { effort: mode === 'analysis' ? 'medium' : 'low' },
      store: false
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error((data.error && data.error.message) || '请求 OpenAI 失败，请检查 API Key 与账户额度。');
  }
  const text = data.output_text || (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
  if (!text) throw new Error('OpenAI 没有返回可显示的文本。');
  return text;
}

// Gemini 3 起官方明确要求 temperature 保持默认值 1.0：调低会引发复读循环、复杂推理退化，
// 所以只有 2.5 及更早的老模型才显式传 temperature，新模型一律交给默认值。
function buildGeminiGenerationConfig(model, mode) {
  const major = parseInt((/^gemini-(\d+)/.exec(model) || [])[1], 10);
  if (!(major >= 1 && major <= 2)) return {};
  // 老模型的分析模式用 temperature 0，保证同样的数据得到尽量一致的输出
  return { temperature: mode === 'analysis' ? 0 : 0.7 };
}

// 直连 Google Gemini API
async function requestGemini(model, systemPromptText, messages, mode) {
  const conversationTurns = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }]
  }));
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${getActiveApiKey()}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPromptText }] },
      contents: conversationTurns,
      generationConfig: buildGeminiGenerationConfig(model, mode)
    })
  });
  const data = await response.json();
  if (!response.ok || !data.candidates || !data.candidates[0].content || !data.candidates[0].content.parts) {
    const msg = data.error ? data.error.message : "请求 Gemini 失败，请检查 API Key 是否有效。";
    throw new Error(msg);
  }
  return data.candidates[0].content.parts.map(part => part.text || "").join("");
}

// 三种模式共用的请求逻辑：发消息、带上下文调用 AI（Claude / Gemini）、渲染回复、按模式解析结构化数据
async function callAiCoach(userText, { mode }) {
  const provider = getAiProvider();
  const conf = AI_PROVIDERS[provider];
  const apiKey = getActiveApiKey();
  const model = conf.models.some(m => m.id === state.settings.apiModel) ? state.settings.apiModel : conf.defaultModel;
  const coachName = conf.coachName;
  const session = getActiveChatSession();

  // 1. 将用户的提问呈现在 UI 聊天框中，并计入当前会话历史
  appendMessage("user", "你", userText);

  // 2. 检测 API Key 是否配置
  if (!apiKey) {
    setTimeout(() => {
      appendMessage("ai", coachName, `未检测到您的 ${conf.keyLabel}。

我已经将您的最近健身打卡数据与刚才的提问打包。请切换到「聊天」模式点击“**打包健身数据**”按钮直接复制，在任意 AI 网页端提问即可！
当然，如果您希望在应用内获得直连的丝滑对话，可以在“设置”页面中输入您的 ${conf.keyLabel}。`);
    }, 600);
    return;
  }

  // 3. 系统指令：健身数据背景 + 器材白名单是所有模式的公共底座；
  //    菜单模式追加结构化训练计划输出格式，分析模式追加恢复分析输出格式
  const focusToday = shouldFocusOnToday(userText, mode);
  let systemPromptText = generateWorkoutSummaryPrompt({ focusToday });
  if (mode === 'menu') systemPromptText += "\n" + buildStructuredPlanInstruction();
  if (mode === 'analysis') systemPromptText += "\n" + buildRecoveryAnalysisInstruction();

  // 4. 训练菜单与身体分析是「当前数据快照」任务，不能把前几天的聊天和旧 JSON
  //    继续发送进去。自由聊天则保留最近 12 条信息以支持正常的追问。
  const history = mode === 'chat'
    ? session.messages.slice(-12)
    : [{ role: 'user', name: '你', text: userText }];

  // 5. 显示 AI 正在思考 (Typing...)
  const pendingText = mode === 'menu' ? "正在为你安排训练菜单，请稍候..."
    : mode === 'analysis' ? "正在分析你的训练分布与恢复状况，请稍候..."
    : "正在思考中，请稍候...";
  const tempBubbleId = appendMessage("ai", coachName, pendingText, true);

  try {
    const rawReplyText = provider === 'gemini'
      ? await requestGemini(model, systemPromptText, history, mode)
      : provider === 'openai'
        ? await requestOpenAI(model, systemPromptText, history, mode)
        : await requestClaude(model, systemPromptText, history, mode);

    removeMessage(tempBubbleId);
    let displayText = rawReplyText;

    if (mode === 'menu') {
      const { cleanedText, items } = extractAiPlanFromReply(rawReplyText);
      displayText = cleanedText;
      if (items.length > 0) {
        setAiRecommendations(items);
        if (state.settings.githubToken) syncWithGithub(true);
        displayText += `\n\n✅ 已为你生成 ${items.length} 条训练推荐，可以在首页「AI 教练推荐」模块查看，点击完成会自动生成今天的打卡记录。`;
      }
    } else if (mode === 'analysis') {
      const { cleanedText, recovery } = extractAiRecoveryFromReply(rawReplyText);
      displayText = cleanedText;
      if (recovery) {
        applyAiRecoveryAnalysis(recovery);
        displayText += `\n\n✅ 分析结果已推送到「趋势」板块的恢复进度模块。`;
      }
    } else {
      displayText = extractAiPlanFromReply(rawReplyText).cleanedText;
    }

    appendMessage("ai", coachName, displayText);
  } catch (error) {
    removeMessage(tempBubbleId);
    appendMessage("ai", coachName, `❌ 发生错误：${error.message}`);
  }
}

// 辅助：向 UI 添加对话气泡。persist=true 时会把消息计入当前会话历史并写入 localStorage
// (回放历史会话/渲染欢迎语时传 persist=false，避免重复写入)
function appendMessage(sender, senderName, text, isPending = false, persist = true) {
  const container = document.getElementById("chat-messages-container");
  if (!container) return;

  const bubbleId = "chat-bubble-" + Date.now() + Math.random().toString(36).substr(2, 5);
  const bubble = document.createElement("div");
  bubble.id = bubbleId;
  bubble.className = `chat-bubble ${sender}-bubble`;

  // 简易格式化 Markdown
  const formattedText = formatChatMessageText(text);

  const d = new Date();
  const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  bubble.innerHTML = `
    <div class="bubble-header">
      <span class="bubble-sender">${senderName}</span>
      <span class="bubble-time">${timeStr}</span>
    </div>
    <div class="bubble-text">${formattedText}</div>
  `;

  if (isPending) {
    bubble.classList.add("chat-bubble-pending");
  }

  container.appendChild(bubble);
  // 滚动至最下方
  container.scrollTop = container.scrollHeight;

  if (persist && !isPending) {
    const session = getActiveChatSession();
    session.messages.push({ role: sender, name: senderName, text: text, time: d.getTime() });
    session.updatedAt = d.getTime();
    persistChatSessions();
    renderChatHistoryList();
  }

  return bubbleId;
}

function removeMessage(id) {
  const element = document.getElementById(id);
  if (element) element.remove();
}

// 简易 markdown 转 HTML 渲染器
function formatChatMessageText(text) {
  if (!text) return "";
  
  let formatted = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // 渲染粗体 **text**
  formatted = formatted.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // 渲染斜体 *text*
  formatted = formatted.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // 换行替换成 <br>
  formatted = formatted.replace(/\n/g, "<br>");
  
  return formatted;
}

// ==========================================================================
// 8. 设置数据存取与备份 (Settings & Backup/Restore)
// ==========================================================================
// 把设置数据（提供方/模型下拉/Key/体重）同步到设置页 UI 控件
function syncSettingsUI() {
  const provider = getAiProvider();
  const conf = AI_PROVIDERS[provider];

  const weightInput = document.getElementById("setting-weight");
  if (weightInput) weightInput.value = (Number(state.settings.weight) || 70).toFixed(1);

  const providerSel = document.getElementById("setting-api-provider");
  if (providerSel) providerSel.value = provider;

  const keyLabel = document.getElementById("setting-api-key-label");
  if (keyLabel) keyLabel.textContent = conf.keyLabel;

  const keyInput = document.getElementById("setting-api-key");
  if (keyInput) {
    keyInput.placeholder = conf.keyPlaceholder;
    keyInput.value = (state.settings.apiKeys && state.settings.apiKeys[provider]) || (provider === state.settings.apiProvider ? state.settings.apiKey : "") || "";
  }

  const modelSel = document.getElementById("setting-api-model");
  if (modelSel) {
    modelSel.innerHTML = conf.models.map(m => `<option value="${m.id}">${m.name}</option>`).join("");
    const wanted = conf.models.some(m => m.id === state.settings.apiModel) ? state.settings.apiModel : conf.defaultModel;
    modelSel.value = wanted;
  }

  const hint = document.getElementById("setting-api-hint");
  if (hint) hint.innerHTML = conf.hint;
}

// 切换 AI 提供方：先切模型下拉与 Key 显示，默认选中该提供方的默认模型，再持久化
function onProviderChange() {
  const provider = document.getElementById("setting-api-provider").value || 'claude';
  state.settings.apiProvider = provider;
  // 切换后模型默认取该提供方默认模型（避免残留另一提供方的模型 id）
  state.settings.apiModel = AI_PROVIDERS[provider].defaultModel;
  syncSettingsUI();
  saveSettings();
}

function saveSettings() {
  const weight = Math.round((parseFloat(document.getElementById("setting-weight").value) || 70) * 10) / 10;
  const apiProvider = document.getElementById("setting-api-provider").value || 'claude';
  const apiKey = document.getElementById("setting-api-key").value.trim();
  const apiModel = document.getElementById("setting-api-model").value;
  const githubToken = document.getElementById("setting-github-token").value.trim();
  const githubGistId = document.getElementById("setting-github-gist-id").value.trim();

  // 每个提供方各自保存一份 Key，切换提供方时不会互相覆盖
  const apiKeys = Object.assign({}, state.settings.apiKeys);
  apiKeys[apiProvider] = apiKey;

  state.settings = {
    weight: weight,
    apiProvider: apiProvider,
    apiKey: apiKey,
    apiKeys: apiKeys,
    apiModel: apiModel,
    githubToken: githubToken,
    githubGistId: githubGistId
  };

  localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));

  // 更新设置的同步文字
  const syncStatus = document.getElementById("github-sync-status");
  if (syncStatus) {
    if (githubToken && githubGistId) {
      syncStatus.textContent = "已关联云端存储";
      syncStatus.style.color = "var(--neon-blue)";
    } else if (githubToken) {
      syncStatus.textContent = "已配置Token，待首次同步";
      syncStatus.style.color = "var(--text-secondary)";
    } else {
      syncStatus.textContent = "未配置同步";
      syncStatus.style.color = "var(--text-secondary)";
    }
  }
}

// 导出所有数据为 JSON 下载 (已剥离敏感凭据，备份文件可安全分享)
function exportData() {
  // 深度复制设置，并剔除敏感凭据：AI API Key 和 GitHub Token 都不能进备份文件
  const settingsToExport = { ...state.settings };
  delete settingsToExport.apiKey;
  delete settingsToExport.apiKeys;
  delete settingsToExport.githubToken;

  const dataStr = JSON.stringify({
    version: "1.2",
    workouts: state.workouts,
    measurements: state.measurements,
    deleted: state.deletedIds,
    settings: settingsToExport
  }, null, 2);
  
  const blob = new Blob([dataStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement("a");
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  
  a.href = url;
  a.download = `chocozap_workout_backup_${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 导入 JSON 备份文件 (已升级为无损双向合并算法，且强行保留本地已配置的 API Key)
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      
      if (Array.isArray(data.workouts)) {
        // 无损去重合并算法：基于 ID 合并本地和导入的数据
        const localWorkouts = state.workouts || [];
        const importedWorkouts = data.workouts || [];
        
        const mergedMap = new Map();
        // 放入导入的历史记录 (导入备份是显式的"恢复"操作，可复活本地已删除的记录)
        importedWorkouts.forEach(w => {
          mergedMap.set(w.id, w);
          delete state.deletedIds[w.id];
        });
        // 放入本地已有的记录 (若有冲突，本地最新记录优先)
        localWorkouts.forEach(w => mergedMap.set(w.id, w));

        // 合并备份文件中的删除墓碑 (仅对本地不存在的记录生效，导入不会删除本地数据)
        if (data.deleted && typeof data.deleted === 'object') {
          Object.keys(data.deleted).forEach(id => {
            if (!mergedMap.has(id)) state.deletedIds[id] = data.deleted[id];
          });
        }
        localStorage.setItem("chocozap_deleted", JSON.stringify(state.deletedIds));

        // 转回数组并按日期从新到旧排序
        const mergedList = Array.from(mergedMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));

        state.workouts = mergedList;
        localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));
        
        // 合并身体数据（按 id 去重，本地优先）
        if (Array.isArray(data.measurements)) {
          const mMap = new Map();
          data.measurements.forEach(m => { if (m && m.id) mMap.set(m.id, m); });
          (state.measurements || []).forEach(m => { if (m && m.id) mMap.set(m.id, m); });
          state.measurements = Array.from(mMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
          localStorage.setItem("chocozap_measurements", JSON.stringify(state.measurements));
        }

        if (data.settings) {
          // 增量融合配置，保留本地已有的 API key（顶层与各提供方 apiKeys 都不覆盖）
          const keepKey = state.settings.apiKey;
          const keepKeys = state.settings.apiKeys;
          state.settings = {
            ...state.settings,
            ...data.settings,
            apiKey: keepKey,
            apiKeys: keepKeys
          };
          localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
          syncSettingsUI();
        }

        alert("🎉 数据合并导入成功！电脑与手机的数据已完美融合。");
        // 刷新
        updateStats();
        renderHistory();
        switchTab('dashboard');
      } else {
        alert("导入失败：非合法的 ChocoZAP 备份 JSON 文件。");
      }
    } catch(err) {
      alert("导入失败：文件解析错误。");
    }
  };
  reader.readAsText(file);
}

// 清空重置数据库 (已升级为双向同步清空：若开启了云同步，将同步清空 GitHub 云端，防止刷新后从云端重新拉回)
async function resetDatabase() {
  if (!confirm("🚨 警告：这会清空你本地存储的全部健身打卡数据！确定要继续吗？")) {
    return;
  }
  if (!confirm("再一次确认：确定要彻底清除数据吗？（保留您的 API Key 和体重配置，仅清空本地和云端的打卡历史记录）")) {
    return;
  }

  const token = state.settings.githubToken;
  const gistId = state.settings.githubGistId;

  // 1. 把当前本地全部记录 + 待处理的 AI 推荐都写入删除墓碑，防止其他设备把老数据同步回来
  const now = Date.now();
  const tombstones = { ...state.deletedIds };
  (state.workouts || []).forEach(w => { tombstones[w.id] = now; });
  (state.aiRecommendations || []).forEach(r => { tombstones[r.id] = now; });

  // 2. 如果已配置云端同步，必须同步清空 GitHub Gist 云端数据，否则刷新后会自动拉回
  if (token && gistId) {
    const resetBtn = document.querySelector(".settings-card.border-danger .btn-danger");
    if (resetBtn) {
      resetBtn.disabled = true;
      resetBtn.innerHTML = "⌛ 正在同步清空云端...";
    }

    const headers = {
      "Authorization": `token ${token}`,
      "Accept": "application/vnd.github.v3+json",
      "Content-Type": "application/json"
    };

    try {
      // 先拉取云端，把云端已有而本地没有的记录/推荐 ID 也一并写入墓碑
      const getResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "GET",
        headers: headers
      });
      if (getResponse.ok) {
        const gistDetail = await getResponse.json();
        const syncFile = gistDetail.files["chocozap_workouts.json"];
        if (syncFile && syncFile.content) {
          const parsed = parseCloudContent(syncFile.content);
          parsed.workouts.forEach(w => { tombstones[w.id] = now; });
          parsed.recommendations.forEach(r => { tombstones[r.id] = now; });
          Object.keys(parsed.deleted).forEach(id => {
            if (!tombstones[id]) tombstones[id] = parsed.deleted[id];
          });
        }
      }

      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify({
          files: {
            "chocozap_workouts.json": {
              "content": JSON.stringify({ workouts: [], recommendations: [], deleted: tombstones }, null, 2)
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error("云端数据更新失败");
      }
    } catch (e) {
      console.error("Failed to clear cloud Gist: ", e);
      alert("⚠️ 清空 GitHub 云端数据失败，将仅清空本地数据。错误: " + e.message);
    }
  }

  // 3. 清空本地历史/推荐/身体数据并保存墓碑，保持 has_run_before 状态，防止重新加载时写入 mock 数据
  localStorage.setItem("chocozap_workouts", JSON.stringify([]));
  localStorage.setItem("chocozap_ai_recommendations", JSON.stringify([]));
  localStorage.setItem("chocozap_measurements", JSON.stringify([]));
  localStorage.setItem("chocozap_deleted", JSON.stringify(tombstones));
  localStorage.setItem("chocozap_has_run_before", "true");

  // 4. 重新加载页面刷新至最空状态
  location.reload();
}

// 监听窗口尺寸变化，重绘图表确保自适应宽度
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const dashboardView = document.getElementById("view-dashboard");
    if (dashboardView && dashboardView.classList.contains("active")) {
      drawWeeklyChart();
    }
  }, 250);
});

// ==========================================================================
// 9. GitHub Gist 云端自动同步功能 (GitHub Gist Cloud Sync)
// ==========================================================================

// 解析云端 Gist 文件内容：兼容旧版纯数组格式和新版 { workouts, recommendations, deleted } 对象格式
function parseCloudContent(content) {
  let workouts = [];
  let recommendations = [];
  let deleted = {};
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) {
      workouts = parsed;
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.workouts)) workouts = parsed.workouts;
      if (Array.isArray(parsed.recommendations)) recommendations = parsed.recommendations;
      if (parsed.deleted && typeof parsed.deleted === 'object') deleted = parsed.deleted;
    }
  } catch (e) {
    // 内容损坏时视为空
  }
  return { workouts, recommendations, deleted };
}

// 墓碑保留 180 天后自动清理，防止无限膨胀 (届时所有设备早已同步过删除操作)
const TOMBSTONE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

function pruneTombstones(deletedMap) {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  Object.keys(deletedMap).forEach(id => {
    if (!deletedMap[id] || deletedMap[id] < cutoff) delete deletedMap[id];
  });
  return deletedMap;
}

async function syncWithGithub(isSilent = false) {
  const token = state.settings.githubToken;
  let gistId = state.settings.githubGistId;
  
  const syncBtn = document.getElementById("btn-github-sync");
  const statusLabel = document.getElementById("github-sync-status");
  
  if (!token) {
    if (!isSilent) {
      alert("请先在设置中配置您的 GitHub Personal Access Token (PAT)！");
      switchTab('settings');
    }
    return;
  }
  
  // 更新 UI 状态
  if (syncBtn) {
    syncBtn.closest(".settings-action-row").classList.add("syncing");
    syncBtn.disabled = true;
    syncBtn.querySelector("span").textContent = "正在云同步...";
  }
  if (statusLabel) {
    statusLabel.textContent = "正在连接 GitHub...";
    statusLabel.style.color = "var(--text-secondary)";
    statusLabel.style.textShadow = "none";
  }
  
  const headers = {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };
  
  try {
    // 1. 如果本地没有绑定 Gist ID，先去云端搜索该账号下是否已经有已建好的 ChocoZAP 专属 Gist
    if (!gistId) {
      if (statusLabel) statusLabel.textContent = "正在云端检索已有存储...";
      
      try {
        const gistsResponse = await fetch("https://api.github.com/gists", {
          method: "GET",
          headers: headers
        });
        
        if (gistsResponse.ok) {
          const gists = await gistsResponse.json();
          // 查找是否有名为 "chocozap_workouts.json" 文件的 gist
          const foundGist = gists.find(g => g.files && g.files["chocozap_workouts.json"]);
          
          if (foundGist) {
            gistId = foundGist.id;
            state.settings.githubGistId = gistId;
            localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
            
            const gistInput = document.getElementById("setting-github-gist-id");
            if (gistInput) gistInput.value = gistId;
            
            if (statusLabel) statusLabel.textContent = "已找到云端已有存储，正在绑定...";
          }
        }
      } catch (err) {
        console.warn("云端检索失败，将尝试直接新建: ", err);
      }
    }

    // 2. 如果云端和本地确实都没有 Gist ID，说明是首次使用，创建全新的 Gist
    if (!gistId) {
      if (statusLabel) statusLabel.textContent = "正在创建全新私有云存储...";
      
      const createResponse = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          description: "ChocoZAP Workout Tracker Cloud Sync Data",
          public: false,
          files: {
            "chocozap_workouts.json": {
              "content": "[]"
            }
          }
        })
      });
      
      if (!createResponse.ok) {
        throw new Error(`创建 Gist 失败: ${createResponse.statusText} (错误码: ${createResponse.status})`);
      }
      
      const gistData = await createResponse.json();
      gistId = gistData.id;
      
      // 保存本地
      state.settings.githubGistId = gistId;
      localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
      
      const gistInput = document.getElementById("setting-github-gist-id");
      if (gistInput) gistInput.value = gistId;
      
      if (statusLabel) statusLabel.textContent = "已成功创建并绑定私有云存储！";
    }
    
    // 2. 从云端拉取已存在的数据
    if (statusLabel) statusLabel.textContent = "正在拉取云端健身记录...";
    const getResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "GET",
      headers: headers
    });
    
    if (getResponse.status === 404) {
      // 说明绑定的 Gist 已经在 GitHub 上被删除了，需要清空本地 ID 并重试
      state.settings.githubGistId = "";
      localStorage.setItem("chocozap_settings", JSON.stringify(state.settings));
      const gistInput = document.getElementById("setting-github-gist-id");
      if (gistInput) gistInput.value = "";
      throw new Error("云端绑定的存储已被删除，已为您重置。请重新点击同步以新建云存储！");
    }
    
    if (!getResponse.ok) {
      throw new Error(`获取云端数据失败: ${getResponse.statusText}`);
    }
    
    const gistDetail = await getResponse.json();
    const syncFile = gistDetail.files["chocozap_workouts.json"];

    let cloudWorkouts = [];
    let cloudRecommendations = [];
    let cloudDeleted = {};
    if (syncFile && syncFile.content) {
      const parsed = parseCloudContent(syncFile.content);
      cloudWorkouts = parsed.workouts;
      cloudRecommendations = parsed.recommendations;
      cloudDeleted = parsed.deleted;
    }

    // 3. 执行无损去重新旧合并
    if (statusLabel) statusLabel.textContent = "正在融合双端记录...";
    const localWorkouts = state.workouts || [];
    const localRecommendations = state.aiRecommendations || [];

    // 先合并双端的删除墓碑 (任意一端删除过的记录/推荐，两端都视为已删除；两者 id 前缀不同不会互相冲突)
    const mergedDeleted = pruneTombstones({ ...cloudDeleted, ...state.deletedIds });

    const mergedMap = new Map();
    // 放入云端数据
    cloudWorkouts.forEach(w => mergedMap.set(w.id, w));
    // 放入本地数据 (本地修改有更高保留优先权)
    localWorkouts.forEach(w => mergedMap.set(w.id, w));
    // 剔除所有已被删除的记录，防止被删记录借合并"复活"
    Object.keys(mergedDeleted).forEach(id => mergedMap.delete(id));

    const mergedList = Array.from(mergedMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));

    // AI 推荐列表走同样的"按 id 合并 + 墓碑过滤"逻辑，已完成/已拒绝的条目不会被云端旧数据带回来
    const mergedRecMap = new Map();
    cloudRecommendations.forEach(r => mergedRecMap.set(r.id, r));
    localRecommendations.forEach(r => mergedRecMap.set(r.id, r));
    Object.keys(mergedDeleted).forEach(id => mergedRecMap.delete(id));
    const mergedRecList = Array.from(mergedRecMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // 更新本地 state 和 localStorage
    state.workouts = mergedList;
    state.aiRecommendations = mergedRecList;
    state.deletedIds = mergedDeleted;
    localStorage.setItem("chocozap_workouts", JSON.stringify(state.workouts));
    localStorage.setItem("chocozap_ai_recommendations", JSON.stringify(state.aiRecommendations));
    localStorage.setItem("chocozap_deleted", JSON.stringify(state.deletedIds));

    // 4. 将合并后的最新数据推回云端 Gist (新格式同时携带记录、AI 推荐和删除墓碑)
    if (statusLabel) statusLabel.textContent = "正在上传备份到云端...";
    const patchResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      headers: headers,
      body: JSON.stringify({
        files: {
          "chocozap_workouts.json": {
            "content": JSON.stringify({ workouts: state.workouts, recommendations: state.aiRecommendations, deleted: state.deletedIds }, null, 2)
          }
        }
      })
    });
    
    if (!patchResponse.ok) {
      throw new Error(`上传云端备份失败: ${patchResponse.statusText}`);
    }
    
    // 5. 同步成功，重绘界面与状态
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    if (statusLabel) {
      statusLabel.textContent = `同步成功 (合并后共 ${state.workouts.length} 条记录，于 ${timeStr})`;
      statusLabel.style.color = "var(--neon-green)";
      statusLabel.style.textShadow = "0 0 8px rgba(57, 255, 20, 0.3)";
    }
    
    // 刷新页面渲染
    updateStats();
    renderHistory();
    renderAiRecommendations();

    if (!isSilent) {
      alert("🎉 双端数据云同步成功！打卡记录已无损合并。");
    }
    
  } catch (error) {
    console.error("Gist Sync Error: ", error);
    if (statusLabel) {
      statusLabel.textContent = `同步失败: ${error.message}`;
      statusLabel.style.color = "var(--danger-color)";
      statusLabel.style.textShadow = "none";
    }
    if (!isSilent) {
      alert(`❌ 云同步失败：${error.message}`);
    }
  } finally {
    // 恢复按钮 UI
    if (syncBtn) {
      syncBtn.closest(".settings-action-row").classList.remove("syncing");
      syncBtn.disabled = false;
      syncBtn.querySelector("span").textContent = "立即同步云端数据";
    }
  }
}
