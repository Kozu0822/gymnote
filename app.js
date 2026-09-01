// GymNote - Local Workout Tracker Logic

const GIST_FILE_NAME = "gymnote-data.json";
const LEGACY_GIST_FILE_NAME = "chocozap_workouts.json";
const LEGACY_STORAGE_KEYS = [
  "theme", "has_run_before", "workouts", "settings", "deleted",
  "ai_recommendations", "measurements", "chat_sessions",
  "active_chat_session", "recovery_ai"
];

// The GitHub Pages path can change during a rename, but localStorage is scoped to
// the user's github.io origin. Copy once rather than deleting the old values so a
// user can still roll back to an older deployed page without losing their data.
function migrateLegacyStorage() {
  LEGACY_STORAGE_KEYS.forEach(key => {
    const target = `gymnote_${key}`;
    const legacy = `chocozap_${key}`;
    if (localStorage.getItem(target) === null && localStorage.getItem(legacy) !== null) {
      localStorage.setItem(target, localStorage.getItem(legacy));
    }
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON.stringify keeps the JavaScript string valid; escaping additionally keeps
// it contained when inserted into an HTML attribute for legacy inline handlers.
function inlineString(value) {
  return escapeHtml(JSON.stringify(String(value ?? "")));
}

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
    coachNameKey: 'ai.coachClaude',
    keyLabel: 'Claude API Key',
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-opus-4-8',
    hintKey: 'set.hintClaude',
    models: [
      { id: 'claude-opus-4-8', nameKey: 'model.claudeOpus' },
      { id: 'claude-sonnet-5', nameKey: 'model.claudeSonnet' },
      { id: 'claude-haiku-4-5', nameKey: 'model.claudeHaiku' }
    ]
  },
  gemini: {
    label: 'Gemini (Google)',
    coachNameKey: 'ai.coachGemini',
    keyLabel: 'Gemini API Key',
    keyPlaceholder: 'AIzaSy...',
    defaultModel: 'gemini-3.7-flash',
    hintKey: 'set.hintGemini',
    models: [
      { id: 'gemini-3.7-flash', nameKey: 'model.geminiFlash' },
      { id: 'gemini-3.1-pro-preview', nameKey: 'model.geminiPro' },
      { id: 'gemini-3.1-flash-lite', nameKey: 'model.geminiLite' }
    ]
  },
  openai: {
    label: 'ChatGPT (OpenAI)',
    coachNameKey: 'ai.coachOpenai',
    keyLabel: 'OpenAI API Key',
    keyPlaceholder: 'sk-proj-...',
    defaultModel: 'gpt-5.6-terra',
    hintKey: 'set.hintOpenai',
    models: [
      { id: 'gpt-5.6-terra', nameKey: 'model.gptTerra' },
      { id: 'gpt-5.6-sol', nameKey: 'model.gptSol' },
      { id: 'gpt-5.6-luna', nameKey: 'model.gptLuna' }
    ]
  }
};

function getAiProvider() {
  return AI_PROVIDERS[state.settings.apiProvider] ? state.settings.apiProvider : 'claude';
}

function getAiCoachName() {
  return t(AI_PROVIDERS[getAiProvider()].coachNameKey);
}

// 用户配置的器械清单，用于约束 AI 只推荐这些器材范围内的动作
const EQUIPMENT_ROSTER = [
  { type: "leg_press", en: "Leg Press", noteKey: "equip.legPressNote" },
  { type: "shoulder_press", en: "Shoulder Press", noteKey: "equip.shoulderPressNote" },
  { type: "chest_press", en: "Chest Press", noteKey: "equip.chestPressNote" },
  { type: "preacher_curl", en: "Preacher Curl", noteKey: "equip.preacherCurlNote" },
  { type: "lat_pulldown", en: "Lat Pulldown", noteKey: "equip.latPulldownNote" },
  { type: "situps", en: "Sit-ups", noteKey: "equip.situpsNote" },
  { type: "spin_bike", en: "Spin Bike", noteKey: "equip.spinBikeNote" },
  { type: "treadmill", en: "Treadmill", noteKey: "equip.treadmillNote" },
  { type: "massage_chair", en: "Massage Chair", noteKey: "equip.massageChairNote" }
];

// 器械在当前语言下的展示名，形如「レッグプレス (Leg Press)」。
// 英文名始终保留，AI 与用户都能明确对应到具体器械
function equipmentLabel(item) {
  return `${t('type.' + item.type)} (${item.en})`;
}

// 默认力量器械配重片的最小调整单位 (kg)，不支持 2.5kg 这种半档
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
    notes: t('mock.note1')
  },
  {
    id: "mock-2",
    date: getPastDateString(5),
    type: "leg_press",
    details: { weight: 50, reps: 12, sets: 3 },
    notes: t('mock.note2')
  },
  {
    id: "mock-3",
    date: getPastDateString(5),
    type: "shoulder_press",
    details: { weight: 20, reps: 10, sets: 3 },
    notes: t('mock.note3')
  },
  {
    id: "mock-4",
    date: getPastDateString(4),
    type: "spin_bike",
    details: { resistance: 8, time: 20 },
    notes: t('mock.note4')
  },
  {
    id: "mock-5",
    date: getPastDateString(3),
    type: "chest_press",
    details: { weight: 30, reps: 12, sets: 3 },
    notes: t('mock.note5')
  },
  {
    id: "mock-6",
    date: getPastDateString(3),
    type: "massage_chair",
    details: { mode: "自动舒缓", duration: 30, intensity: 2 },
    notes: t('mock.note6')
  },
  {
    id: "mock-7",
    date: getPastDateString(1),
    type: "leg_press",
    details: { weight: 60, reps: 10, sets: 4 },
    notes: t('mock.note7')
  },
  {
    id: "mock-8",
    date: getPastDateString(1),
    type: "situps",
    details: { reps: 20, sets: 3 },
    notes: t('mock.note8')
  },
  {
    id: "mock-9",
    date: getPastDateString(0), // 今天
    type: "treadmill",
    details: { mode: "run", speed: 8.5, incline: 2, time: 30, distance: 4.25, calories: 310 },
    notes: t('mock.note9')
  }
];

// 初始化加载
document.addEventListener("DOMContentLoaded", () => {
  migrateLegacyStorage();
  // 语言要在任何渲染之前就位：先写好 <html lang> 与静态节点文案
  applyDocumentLang();
  applyStaticI18n();
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

// 语言切换回调（由 i18n.js 的 setLang 调用）：
// 静态节点已由 applyStaticI18n 处理，这里负责所有由 JS 生成的动态内容。
// 打卡表单正开着时，重建字段会丢掉用户已填的值，所以只在项目选择阶段重绘表单区
function onLanguageChanged() {
  refreshHeaderDate();
  renderLogProjectGrid();
  updateStats();
  renderHistory();
  renderTrendsTab();
  renderAiRecommendations();
  syncSettingsUI();
  refreshSyncStatusLabel();

  const formStage = document.getElementById("log-form-stage");
  if (formStage && formStage.style.display !== 'none') {
    // 表单开着：只刷新标题与按钮，输入过的数值保持不变
    const type = document.getElementById("input-exercise-type").value;
    const meta = LOG_META[type] || {};
    const titleEl = document.getElementById("form-title");
    if (titleEl) titleEl.textContent = LOG_META[type] ? typeName(type) : t('log.exercise');
    const badgeEl = document.getElementById("form-badge-type");
    if (badgeEl) badgeEl.textContent = meta.badgeKey ? t(meta.badgeKey) : "";
    syncLogSubmitLabel();
  }

  if (currentAiMode) syncAiModeUI();
  renderChatSessionMessages();
  renderChatHistoryList();
}

// 云同步状态文案：设置读写与语言切换都走这里，避免多处重复
function refreshSyncStatusLabel() {
  const syncStatus = document.getElementById("github-sync-status");
  if (!syncStatus) return;
  if (state.settings.githubToken && state.settings.githubGistId) {
    syncStatus.textContent = t('sync.statusLinked');
    syncStatus.style.color = "var(--neon-blue)";
  } else if (state.settings.githubToken) {
    syncStatus.textContent = t('sync.statusToken');
    syncStatus.style.color = "var(--text-secondary)";
  } else {
    syncStatus.textContent = t('sync.statusNone');
    syncStatus.style.color = "var(--text-secondary)";
  }
}

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
  localStorage.setItem("gymnote_theme", next);
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
  const hasRunBefore = localStorage.getItem("gymnote_has_run_before");
  const storedWorkouts = localStorage.getItem("gymnote_workouts");
  const storedSettings = localStorage.getItem("gymnote_settings");

  // 加载已删除记录的墓碑表
  try {
    state.deletedIds = JSON.parse(localStorage.getItem("gymnote_deleted") || "{}") || {};
  } catch (e) {
    state.deletedIds = {};
  }

  // 加载 AI 训练推荐列表
  try {
    state.aiRecommendations = JSON.parse(localStorage.getItem("gymnote_ai_recommendations") || "[]") || [];
  } catch (e) {
    state.aiRecommendations = [];
  }

  // 加载身体数据记录（体重/臂围/腰围/胸围）
  try {
    state.measurements = JSON.parse(localStorage.getItem("gymnote_measurements") || "[]") || [];
  } catch (e) {
    state.measurements = [];
  }

  // 加载 AI 多会话聊天记录
  try {
    state.chatSessions = JSON.parse(localStorage.getItem("gymnote_chat_sessions") || "[]") || [];
  } catch (e) {
    state.chatSessions = [];
  }
  state.activeChatSessionId = localStorage.getItem("gymnote_active_chat_session") || null;
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
    localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));
    localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
    localStorage.setItem("gymnote_has_run_before", "true");
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
      localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
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

  refreshSyncStatusLabel();
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
  { type: 'leg_press', icon: '🦵', tagKey: 'cat.strength' },
  { type: 'shoulder_press', icon: '💪', tagKey: 'cat.strength' },
  { type: 'chest_press', icon: '🏋️', tagKey: 'cat.strength' },
  { type: 'preacher_curl', icon: '🧘', tagKey: 'cat.strength' },
  { type: 'lat_pulldown', icon: '🔽', tagKey: 'cat.strength' },
  { type: 'situps', icon: '🧗', tagKey: 'cat.core' },
  { type: 'spin_bike', icon: '🚴', tagKey: 'cat.cardio' },
  { type: 'treadmill', icon: '🏃', tagKey: 'cat.cardio' },
  { type: 'massage_chair', icon: '💆', tagKey: 'cat.relax' },
  { type: 'body_metrics', icon: '📏', tagKey: 'cat.body' },
  { type: 'custom', icon: '⚙️', tagKey: 'cat.other' }
];

// 项目名统一走 t()，历史记录里的自定义项目则使用用户自己填写的名称
function typeName(type) {
  return t('type.' + type);
}

// 渲染打卡页的项目卡片网格
function renderLogProjectGrid() {
  const grid = document.getElementById("log-project-grid");
  if (!grid) return;
  grid.innerHTML = LOG_PROJECTS.map(p => `
    <button type="button" class="log-project-card glass" onclick="openLogForm('${p.type}')">
      <span class="lp-icon">${p.icon}</span>
      <span class="lp-name">${typeName(p.type)}</span>
      <span class="lp-tag">${t(p.tagKey)}</span>
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
  leg_press:      { badgeKey: 'cat.strengthFull', def: { weight: 50, reps: 12, sets: 3 } },
  shoulder_press: { badgeKey: 'cat.strengthFull', def: { weight: 20, reps: 10, sets: 3 } },
  chest_press:    { badgeKey: 'cat.strengthFull', def: { weight: 30, reps: 12, sets: 3 } },
  preacher_curl:  { badgeKey: 'cat.strengthFull', def: { weight: 15, reps: 12, sets: 3 } },
  lat_pulldown:   { badgeKey: 'cat.strengthFull', def: { weight: 35, reps: 12, sets: 3 } },
  situps:         { badgeKey: 'cat.coreFull' },
  spin_bike:      { badgeKey: 'cat.cardioFull' },
  treadmill:      { badgeKey: 'cat.cardioFull' },
  massage_chair:  { badgeKey: 'cat.relaxFull' },
  body_metrics:   { badgeKey: 'cat.bodyFull' },
  custom:         { badgeKey: 'cat.customFull' }
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

// 提交按钮的文案：编辑已有记录时是"保存修改"，否则是"保存本次打卡"。
// 打卡成功后按钮 innerHTML 会被临时替换 1 秒，恢复后要重新调用本函数把文案同步回来
function syncLogSubmitLabel() {
  const label = document.getElementById("log-submit-label");
  if (!label) return;
  const editing = !!(document.getElementById("input-edit-id") || {}).value;
  label.textContent = editing ? t('log.saveEdit') : t('log.save');
}

// 打开某个项目的参数界面（editWorkout 传入时为编辑模式）
function openLogForm(type, editWorkout) {
  const meta = LOG_META[type] || {};
  document.getElementById("log-select-stage").style.display = 'none';
  document.getElementById("log-form-stage").style.display = 'block';
  document.getElementById("input-exercise-type").value = type;
  document.getElementById("input-edit-id").value = editWorkout ? editWorkout.id : "";
  // 保存成功后提交按钮的 innerHTML 会被临时替换 1 秒（显示"打卡成功"），
  // 这期间点历史里的编辑会取不到 log-submit-label，所以这里统一做空值保护
  const titleEl = document.getElementById("form-title");
  if (titleEl) titleEl.textContent = LOG_META[type] ? typeName(type) : t('log.exercise');
  const badgeEl = document.getElementById("form-badge-type");
  if (badgeEl) badgeEl.textContent = meta.badgeKey ? t(meta.badgeKey) : "";
  syncLogSubmitLabel();

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
        ${t('log.addGroupBtn')}
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
        <span class="sg-title">${multi ? t('log.groupN', { n: i + 1 }) : t('log.weightGroup')}</span>
        ${multi ? `<button type="button" class="sg-remove" onclick="removeStrengthGroup('${type}', ${i})">${t('common.remove')}</button>` : ''}
      </div>
      <div class="form-row">
        <label>${t('log.weightKg')} <small>${t('log.weightHint')}</small></label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease-large" onclick="adjustValue('sg-weight-${i}', -5)">-5</button>
          <input type="number" id="sg-weight-${i}" class="sg-weight" value="${g.weight}" min="0" max="300" step="5">
          <button type="button" class="step-btn increase-large" onclick="adjustValue('sg-weight-${i}', 5)">+5</button>
        </div>
      </div>
      <div class="form-row-grid">
        <div class="form-row">
          <label>${t('log.repsPerSet')}</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('sg-reps-${i}', -1)">-</button>
            <input type="number" id="sg-reps-${i}" class="sg-reps" value="${g.reps}" min="1" max="100">
            <button type="button" class="step-btn increase" onclick="adjustValue('sg-reps-${i}', 1)">+</button>
          </div>
        </div>
        <div class="form-row">
          <label>${t('log.sets')}</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('sg-sets-${i}', -1)">-</button>
            <input type="number" id="sg-sets-${i}" class="sg-sets" value="${g.sets}" min="1" max="20">
            <button type="button" class="step-btn increase" onclick="adjustValue('sg-sets-${i}', 1)">+</button>
          </div>
        </div>
      </div>
      <div class="form-row">
        <label>${t('log.extraReps')} <small>${t('log.extraRepsHintFull')}</small></label>
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
        <label>${t('log.repsPerSet')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('input-situps-reps', -5)">-5</button>
          <input type="number" id="input-situps-reps" value="${reps}" min="1" max="200">
          <button type="button" class="step-btn increase" onclick="adjustValue('input-situps-reps', 5)">+5</button>
        </div>
      </div>
      <div class="form-row">
        <label>${t('log.sets')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('input-situps-sets', -1)">-</button>
          <input type="number" id="input-situps-sets" value="${sets}" min="1" max="20">
          <button type="button" class="step-btn increase" onclick="adjustValue('input-situps-sets', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>${t('log.extraReps')} <small>${t('common.optionalSuffix')}</small></label>
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
  const unit = type === 'treadmill' ? 'km/h' : t('unit.gear');
  const step = type === 'treadmill' ? '0.5' : '1';
  container.innerHTML = logSegments.map((s, i) => `
    <div class="var-seg" data-idx="${i}">
      <div class="var-seg-fields">
        <div class="form-row">
          <label>${t('log.speed')} (${unit})</label>
          <input type="number" class="seg-speed glass-input" value="${s.speed}" min="0" max="24" step="${step}" oninput="updateCalorieEstimate()">
        </div>
        <div class="form-row">
          <label>${t('log.segDuration')}</label>
          <input type="number" class="seg-dur glass-input" value="${s.duration}" min="0" max="180" step="1" oninput="updateCalorieEstimate()">
        </div>
      </div>
      ${logSegments.length > 1 ? `<button type="button" class="sg-remove" onclick="removeSegment('${type}', ${i})">${t('common.remove')}</button>` : ''}
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
  const unit = type === 'treadmill' ? 'km/h' : t('unit.gear');
  const step = type === 'treadmill' ? '0.5' : '1';
  const wu = (d && d.warmup) || { speed: 0, duration: 0 };
  const sp = (d && d.sprint) || { speed: 0, duration: 0 };
  const total = (d && d.variableSpeed && d.time) ? d.time : '';
  const inclineRow = type === 'treadmill' ? `
      <div class="form-row">
        <label>${t('log.incline')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('input-tmv-incline', -1); updateCalorieEstimate();">-</button>
          <input type="number" id="input-tmv-incline" value="${(d && d.incline != null) ? d.incline : 2}" min="0" max="15" onchange="updateCalorieEstimate()">
          <button type="button" class="step-btn increase" onclick="adjustValue('input-tmv-incline', 1); updateCalorieEstimate();">+</button>
        </div>
      </div>` : '';
  const estRow = type === 'treadmill' ? `
      <div class="form-row estimation-output">
        <div class="est-box"><span class="est-label">${t('log.estDistance')}</span><span class="est-value" id="est-distance-var">0.00 <small>km</small></span></div>
        <div class="est-box"><span class="est-label">${t('log.estCalories')}</span><span class="est-value text-glowing" id="est-calories-var">0 <small>kcal</small></span></div>
      </div>` : '';
  return `
    <div id="var-speed-block" style="display:${(d && d.variableSpeed) ? 'block' : 'none'}">
      ${inclineRow}
      <div class="var-sub-title">${t('log.warmupSection')} <small>${t('log.sectionHintZero')}</small></div>
      <div class="var-seg-fields">
        <div class="form-row"><label>${t('log.speed')} (${unit})</label><input type="number" id="vs-warmup-speed" class="glass-input" value="${wu.speed || 0}" min="0" max="24" step="${step}" oninput="updateCalorieEstimate()"></div>
        <div class="form-row"><label>${t('log.duration')}</label><input type="number" id="vs-warmup-dur" class="glass-input" value="${wu.duration || 0}" min="0" max="180" step="1" oninput="updateCalorieEstimate()"></div>
      </div>
      <div class="var-sub-title">${t('log.varSection')} <small>${t('log.varSectionHint')}</small></div>
      <div id="var-segments"></div>
      <button type="button" class="add-group-btn" onclick="addSegment('${type}')">${t('log.addSegment')}</button>
      <div class="var-sub-title">${t('log.sprintSection')} <small>${t('log.sectionHintZero')}</small></div>
      <div class="var-seg-fields">
        <div class="form-row"><label>${t('log.speed')} (${unit})</label><input type="number" id="vs-sprint-speed" class="glass-input" value="${sp.speed || 0}" min="0" max="24" step="${step}" oninput="updateCalorieEstimate()"></div>
        <div class="form-row"><label>${t('log.duration')}</label><input type="number" id="vs-sprint-dur" class="glass-input" value="${sp.duration || 0}" min="0" max="180" step="1" oninput="updateCalorieEstimate()"></div>
      </div>
      <div class="form-row">
        <label>${t('log.totalTime')} <small>${t('log.totalTimeHint')}</small></label>
        <input type="number" id="vs-total" class="glass-input" value="${total}" min="0" max="300" step="1" placeholder="${t('log.segmentSum')}" oninput="updateCalorieEstimate()">
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
      <label class="var-toggle"><input type="checkbox" id="var-speed-toggle" ${variable ? 'checked' : ''} onchange="onVarSpeedToggle('treadmill')"> ${t('log.varToggle')}</label>
    </div>
    <div id="tm-simple" style="display:${variable ? 'none' : 'block'}">
      <div class="form-row">
        <label>${t('log.exerciseMode')}</label>
        <div class="segmented-control">
          <label class="segment-item"><input type="radio" name="treadmill-mode" value="walk" ${mode === 'walk' ? 'checked' : ''} onchange="updateCalorieEstimate()"><span>${t('log.tmWalk')}</span></label>
          <label class="segment-item"><input type="radio" name="treadmill-mode" value="run" ${mode === 'run' ? 'checked' : ''} onchange="updateCalorieEstimate()"><span>${t('log.tmRun')}</span></label>
        </div>
      </div>
      <div class="form-row-grid">
        <div class="form-row">
          <label>${t('log.speedKmh')}</label>
          <div class="slider-container">
            <input type="range" id="input-treadmill-speed" min="2" max="20" step="0.5" value="${speed}" oninput="updateSliderVal('treadmill-speed-val', this.value); updateCalorieEstimate();">
            <span class="slider-badge"><span id="treadmill-speed-val">${speed}</span> km/h</span>
          </div>
        </div>
        <div class="form-row">
          <label>${t('log.incline')}</label>
          <div class="slider-container">
            <input type="range" id="input-treadmill-incline" min="0" max="15" step="1" value="${incline}" oninput="updateSliderVal('treadmill-incline-val', this.value); updateCalorieEstimate();">
            <span class="slider-badge"><span id="treadmill-incline-val">${incline}</span> %</span>
          </div>
        </div>
      </div>
      <div class="form-row-grid">
        <div class="form-row">
          <label>${t('log.duration')}</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('input-treadmill-time', -5); updateCalorieEstimate();">-5</button>
            <input type="number" id="input-treadmill-time" value="${time}" min="1" max="180" onchange="updateCalorieEstimate()">
            <button type="button" class="step-btn increase" onclick="adjustValue('input-treadmill-time', 5); updateCalorieEstimate();">+5</button>
          </div>
        </div>
        <div class="form-row estimation-output">
          <div class="est-box"><span class="est-label">${t('log.estDistance')}</span><span class="est-value" id="est-distance">3.00 <small>km</small></span></div>
          <div class="est-box"><span class="est-label">${t('log.estCalories')}</span><span class="est-value text-glowing" id="est-calories">185 <small>kcal</small></span></div>
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
      <label class="var-toggle"><input type="checkbox" id="var-speed-toggle" ${variable ? 'checked' : ''} onchange="onVarSpeedToggle('spin_bike')"> ${t('log.varToggle')}</label>
    </div>
    <div id="bike-simple" style="display:${variable ? 'none' : 'block'}">
      <div class="form-row-grid">
        <div class="form-row">
          <label>${t('log.resistance')}</label>
          <div class="stepper-input">
            <button type="button" class="step-btn decrease" onclick="adjustValue('input-bike-resistance', -1)">-</button>
            <input type="number" id="input-bike-resistance" value="${resistance}" min="1" max="24">
            <button type="button" class="step-btn increase" onclick="adjustValue('input-bike-resistance', 1)">+</button>
          </div>
        </div>
        <div class="form-row">
          <label>${t('log.bikeTime')}</label>
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
// 模式在数据层固定用中文常量存储（存量记录与云同步都依赖它），只在展示时翻译
const MASSAGE_MODES = ['自动舒缓', '颈肩重点', '全身拉伸', '腰臀放松'];
const MASSAGE_MODE_KEYS = {
  '自动舒缓': 'mode.auto', '颈肩重点': 'mode.neck',
  '全身拉伸': 'mode.stretch', '腰臀放松': 'mode.hip'
};

// 未知模式（例如用户从旧备份导入的自定义值）直接原样显示
function massageModeLabel(mode) {
  return MASSAGE_MODE_KEYS[mode] ? t(MASSAGE_MODE_KEYS[mode]) : mode;
}

function buildMassageFields(d) {
  const mode = (d && d.mode) || MASSAGE_MODES[0];
  const duration = (d && d.duration) || 30;
  const intensity = (d && d.intensity) || 2;
  const modes = MASSAGE_MODES;
  const durations = [15, 30, 45, 60, 75, 90, 105, 120];
  const durKeys = { 15: 'dur.m15', 30: 'dur.m30', 45: 'dur.m45', 60: 'dur.h1', 75: 'dur.h1m15', 90: 'dur.h1m30', 105: 'dur.h1m45', 120: 'dur.h2' };
  return `
    <div class="form-row">
      <label>${t('log.massageMode')}</label>
      <div class="glass-select-wrapper">
        <select id="input-massage-mode">${modes.map(m => `<option value="${m}" ${m === mode ? 'selected' : ''}>${massageModeLabel(m)}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('log.massageDuration')}</label>
        <div class="glass-select-wrapper">
          <select id="input-massage-duration">${durations.map(v => `<option value="${v}" ${v === Number(duration) ? 'selected' : ''}>${t(durKeys[v])}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <label>${t('log.massageIntensity')}</label>
        <div class="segmented-control">
          <label class="segment-item"><input type="radio" name="massage-intensity" value="1" ${intensity == 1 ? 'checked' : ''}><span>${t('hist.intensityLow')}</span></label>
          <label class="segment-item"><input type="radio" name="massage-intensity" value="2" ${intensity == 2 ? 'checked' : ''}><span>${t('hist.intensityMid')}</span></label>
          <label class="segment-item"><input type="radio" name="massage-intensity" value="3" ${intensity == 3 ? 'checked' : ''}><span>${t('hist.intensityHigh')}</span></label>
        </div>
      </div>
    </div>
  `;
}

// ---- 自定义 ----
function buildCustomFields() {
  return `
    <div class="form-row">
      <label>${t('log.customName')}</label>
      <input type="text" id="input-custom-name" placeholder="${t('log.customNamePlaceholder')}" class="glass-input">
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('log.customValue')}</label>
        <input type="text" id="input-custom-value" placeholder="${t('log.customValuePlaceholder')}" class="glass-input">
      </div>
      <div class="form-row">
        <label>${t('log.customSets')}</label>
        <input type="number" id="input-custom-sets" placeholder="${t('log.customSetsPlaceholder')}" class="glass-input" min="1">
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
      <label>${t('metric.weight')} (kg) <small>${t('log.bmWeightHint')}</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('input-bm-weight', -0.5)">-</button>
        <input type="number" id="input-bm-weight" value="${weight}" min="20" max="300" step="0.1">
        <button type="button" class="step-btn increase" onclick="adjustValue('input-bm-weight', 0.5)">+</button>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('metric.arm')} (cm)</label>
        <input type="number" id="input-bm-arm" class="glass-input" value="${last.arm != null ? last.arm : ''}" placeholder="${t('common.optional')}" min="0" max="100" step="0.1">
      </div>
      <div class="form-row">
        <label>${t('metric.waist')} (cm)</label>
        <input type="number" id="input-bm-waist" class="glass-input" value="${last.waist != null ? last.waist : ''}" placeholder="${t('common.optional')}" min="0" max="200" step="0.1">
      </div>
    </div>
    <div class="form-row">
      <label>${t('metric.chest')} (cm)</label>
      <input type="number" id="input-bm-chest" class="glass-input" value="${last.chest != null ? last.chest : ''}" placeholder="${t('common.optional')}" min="0" max="200" step="0.1">
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
      alert(t('msg.needValidGroup'));
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
      alert(t('msg.needCustomName'));
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
      localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));
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
    localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));
    checkAndCelebratePR(newWorkout);
  }

  if (state.settings.githubToken) {
    syncWithGithub(true);
  }

  onWorkoutSaved(editId ? t('msg.editSaved') : t('msg.logged'), !!editId);
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
      syncLogSubmitLabel();
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

// 保存身体数据（体重/臂围/腰围/胸围）——独立存储 gymnote_measurements
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
    alert(t('msg.needBodyMetric'));
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
  localStorage.setItem("gymnote_measurements", JSON.stringify(state.measurements));

  // 同步更新设置里的体重（用于跑步机热量估算）
  if (weight != null) {
    state.settings.weight = weight;
    localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
    syncSettingsUI();
  }

  onWorkoutSaved(editId ? t('msg.bodyUpdated') : t('msg.bodyRecorded'), false);
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
  if (!confirm(t('msg.confirmDeleteMetric'))) return;
  state.measurements = state.measurements.filter(m => m.id !== id);
  localStorage.setItem("gymnote_measurements", JSON.stringify(state.measurements));
  renderBodyMetrics();
}

// 删除某条打卡记录
function deleteWorkout(id) {
  if (confirm(t('msg.confirmDeleteWorkout'))) {
    state.workouts = state.workouts.filter(w => w.id !== id);
    // 写入墓碑：云同步合并时据此排除该记录，防止删除后被云端数据"复活"
    state.deletedIds[id] = Date.now();
    localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));
    localStorage.setItem("gymnote_deleted", JSON.stringify(state.deletedIds));
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
      <div class="trend-bar-segment trend-bar-strength" style="width:${strengthPct}%" title="${t('dash.legendStrength', { count: strengthCount, pct: strengthPct })}"></div>
      <div class="trend-bar-segment trend-bar-cardio" style="width:${cardioPct}%" title="${t('dash.legendCardio', { count: cardioCount, pct: cardioPct })}"></div>
      <div class="trend-bar-segment trend-bar-other" style="width:${otherPct}%" title="${t('dash.legendOther', { count: otherCount, pct: otherPct })}"></div>
    `;
  }
  document.getElementById("trend-legend-strength").textContent = t('dash.legendStrength', { count: strengthCount, pct: strengthPct });
  document.getElementById("trend-legend-cardio").textContent = t('dash.legendCardio', { count: cardioCount, pct: cardioPct });
  document.getElementById("trend-legend-other").textContent = t('dash.legendOther', { count: otherCount, pct: otherPct });

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
  renderTrendMiniBars("trend-cardio-bars", weekCardioMinutes, t('unit.min'));
}

// 绘制 4 周迷你柱状趋势图 (纯 DOM/CSS，不用 SVG，轻量实现)
function renderTrendMiniBars(containerId, values, unit) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const maxVal = Math.max(...values, 1);
  const weekLabels = [t('week.3ago'), t('week.2ago'), t('week.last'), t('week.this')];

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
    return { value: d.time, unit: t('unit.min') };
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

  const label = typeName(workout.type);
  const icon = PR_TYPE_ICONS[workout.type] || '🏆';
  const msg = priorBest
    ? t('pr.newRecord', { icon, label, value: q.value, unit: q.unit, prev: priorBest.value })
    : t('pr.firstRecord', { icon, label, value: q.value, unit: q.unit });
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
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">📏</div><p>${t('empty.bodyMetrics')}</p></div>`;
    return;
  }

  const metrics = [
    { key: 'weight', label: t('metric.weight'), unit: 'kg' },
    { key: 'arm', label: t('metric.arm'), unit: 'cm' },
    { key: 'waist', label: t('metric.waist'), unit: 'cm' },
    { key: 'chest', label: t('metric.chest'), unit: 'cm' }
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
    if (m.arm != null) parts.push(`${t('metric.armShort')}${m.arm}`);
    if (m.waist != null) parts.push(`${t('metric.waistShort')}${m.waist}`);
    if (m.chest != null) parts.push(`${t('metric.chestShort')}${m.chest}`);
    const p = m.date.split('-');
    const dateLabel = `${parseInt(p[1])}月${parseInt(p[2])}日`;
    return `
      <div class="bm-row">
        <span class="bm-row-date">${dateLabel}</span>
        <span class="bm-row-vals">${parts.join(' · ')}</span>
        <span class="bm-row-actions">
          <button class="bm-row-btn" onclick="editMeasurement('${m.id}')" title="${t('common.edit')}">✎</button>
          <button class="bm-row-btn" onclick="deleteMeasurement('${m.id}')" title="${t('common.delete')}">✕</button>
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
        gridHtml += `<i class="heatmap-cell level-${levelFor(day.count)}" title="${t('trend.calTooltip', { date: day.date, count: day.count })}"></i>`;
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
    legendContainer.innerHTML = `<div class="empty-state"><div class="empty-emoji">🗒️</div><p>${t('empty.part30')}</p></div>`;
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
      arcsHtml = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="var(${colorVar})" stroke-width="${strokeWidth}" class="donut-arc"><title>${t('trend.partTooltip', { part: partLabel(part), count, pct: 100 })}</title></circle>`;
      return;
    }

    const [x1, y1] = polar(startAngle, radius);
    const [x2, y2] = polar(endAngle, radius);
    const largeArc = (endAngle - startAngle) > 180 ? 1 : 0;
    arcsHtml += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}"
      fill="none" stroke="var(${colorVar})" stroke-width="${strokeWidth}" stroke-linecap="butt" class="donut-arc">
      <title>${t('trend.partTooltip', { part: partLabel(part), count, pct })}</title></path>`;
  });

  donutContainer.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" class="donut-svg" role="img" aria-label="${t('trend.partAria')}">
      ${arcsHtml}
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="donut-center-value">${total}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" class="donut-center-label">${t('trend.donutCenter')}</text>
    </svg>
  `;

  // ---- 图例：色点 + 名称 + 次数(%)，文字用文本色而非系列色 ----
  legendContainer.innerHTML = entries.map(([part, count]) => {
    const pct = Math.round((count / total) * 100);
    const colorVar = BODY_PART_COLOR_VARS[part] || '--part-other';
    return `
      <div class="body-part-legend-item">
        <i class="legend-dot" style="background: var(${colorVar})"></i>
        <span class="legend-name">${partLabel(part)}</span>
        <span class="legend-value">${t('trend.partCount', { count, pct })}</span>
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
  if (pct >= 80) return { text: t('rec.recovered'), cls: 'recovery-ok' };
  if (pct >= 40) return { text: t('rec.recovering'), cls: 'recovery-mid' };
  return { text: t('rec.fatigued'), cls: 'recovery-low' };
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
    aiData = JSON.parse(localStorage.getItem("gymnote_recovery_ai") || "null");
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
      const stamp = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      sourceLabel.textContent = t('trend.recoveryAiAt', { time: stamp });
    } else {
      sourceLabel.textContent = t('trend.recoverySourceAlgo');
    }
  }

  if (aiSummaryBox) {
    if (hasAi && aiData.summary) {
      aiSummaryBox.style.display = "block";
      aiSummaryBox.innerHTML = `<span class="recovery-summary-icon">🩺</span>${escapeHtml(aiData.summary)}
        <button class="recovery-clear-ai" onclick="clearAiRecoveryAnalysis()" title="${t('trend.clearAi')}">✕</button>`;
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
          <span class="recovery-part-name">${partLabel(part)}${ai ? '<i class="recovery-ai-badge">AI</i>' : ''}</span>
          <span class="recovery-status-chip ${status.cls}">${status.text} ${pct}%</span>
        </div>
        <div class="recovery-bar-track">
          <div class="recovery-bar-fill ${status.cls}" style="width:${pct}%"></div>
        </div>
        ${ai && ai.comment ? `<div class="recovery-comment">${escapeHtml(ai.comment)}</div>` : ''}
      </div>
    `;
  }).join('');
}

// 清除 AI 分析结果，恢复到纯算法估算
function clearAiRecoveryAnalysis() {
  localStorage.removeItem("gymnote_recovery_ai");
  renderRecoveryStatus();
}

// ---- PR 个人最佳纪录列表 ----
function renderPersonalRecords() {
  const container = document.getElementById("pr-list");
  if (!container) return;

  const records = computeAllPersonalRecords();
  if (records.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-emoji">🏆</div><p>${t('empty.pr')}</p></div>`;
    return;
  }

  container.innerHTML = records.map(({ type, best }) => `
    <div class="pr-item">
      <div class="pr-item-left">
        <div class="pr-item-avatar">${PR_TYPE_ICONS[type] || '🏆'}</div>
        <div class="pr-item-details">
          <span class="pr-item-title">${typeName(type)}</span>
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
    const weekDays = [t('wd.sun'), t('wd.mon'), t('wd.tue'), t('wd.wed'), t('wd.thu'), t('wd.fri'), t('wd.sat')];
    labels.push(i === 0 ? t('common.today') : weekDays[d.getDay()]);
    
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
  const icons = {
    leg_press: '🦵', shoulder_press: '💪', chest_press: '🏋️', preacher_curl: '🧘',
    lat_pulldown: '🔽', situps: '🧗', spin_bike: '🚴', massage_chair: '💆', custom: '⚙️'
  };
  if (item.type === 'treadmill') {
    // 跑步机标题带上模式：インターバル / 早歩き / ジョギング
    const modeText = item.details && item.details.variableSpeed
      ? t('hist.variable')
      : (item.details && item.details.mode === 'walk' ? t('hist.walk') : t('hist.jog'));
    return { icon: '🏃', title: t('hist.titleWithMode', { name: typeName('treadmill'), mode: modeText }) };
  }
  if (item.type === 'massage_chair') {
    const mode = (item.details && item.details.mode) ? massageModeLabel(item.details.mode) : t('hist.massageDefault');
    return { icon: '💆', title: t('hist.titleWithMode', { name: typeName('massage_chair'), mode }) };
  }
  if (item.type === 'custom') {
    // 自定义项目用用户自己填写的名称，没填时回退到通用名
    const name = (item.details && item.details.name) ? item.details.name : t('cat.customFull');
    return { icon: '⚙️', title: name };
  }
  if (!icons[item.type]) return { icon: '⚙️', title: t('hist.workout') };
  return { icon: icons[item.type], title: typeName(item.type) };
}

// 变速有氧的分段文字摘要
function formatVariableSummary(d, unit) {
  const parts = [];
  if (d.warmup && d.warmup.duration > 0) parts.push(t('hist.varWarmup', { speed: d.warmup.speed, unit, dur: d.warmup.duration }));
  (d.segments || []).forEach(s => { if (s.duration > 0) parts.push(t('hist.varSeg', { speed: s.speed, unit, dur: s.duration })); });
  if (d.sprint && d.sprint.duration > 0) parts.push(t('hist.varSprint', { speed: d.sprint.speed, unit, dur: d.sprint.duration }));
  return parts.join(' → ');
}

// 历史卡片的数据摘要文字
function historyStatsText(item) {
  const d = item.details || {};
  if (WEIGHTED_STRENGTH.includes(item.type)) {
    const groups = getStrengthGroups(d);
    return groups.map(g => t('hist.strengthGroup', { weight: g.weight, reps: g.reps, sets: g.sets })
      + (g.extraReps ? t('hist.extraSuffix', { n: g.extraReps }) : "")).join(' ／ ');
  }
  if (item.type === 'situps') {
    return t('hist.repsSets', { reps: d.reps, sets: d.sets }) + (d.extraReps ? t('hist.extraSuffix', { n: d.extraReps }) : "");
  }
  if (item.type === 'spin_bike') {
    if (d.variableSpeed) {
      return t('hist.bikeVar', { time: d.time, summary: formatVariableSummary(d, t('unit.gear')) });
    }
    return t('hist.bikePlain', { resistance: d.resistance + t('unit.gear'), time: d.time });
  }
  if (item.type === 'treadmill') {
    if (d.variableSpeed) {
      return t('hist.tmVar', { time: d.time, incline: d.incline || 0, distance: d.distance, calories: d.calories, summary: formatVariableSummary(d, 'km/h') });
    }
    return t('hist.tmPlain', { time: d.time, speed: d.speed, incline: d.incline, distance: d.distance, calories: d.calories });
  }
  if (item.type === 'massage_chair') {
    const intensityMap = { 1: t('hist.intensityLow'), 2: t('hist.intensityMid'), 3: t('hist.intensityHigh') };
    return t('hist.massageStats', { duration: d.duration, intensity: intensityMap[d.intensity] || t('hist.intensityMid') });
  }
  if (item.type === 'custom') {
    return `${d.value || ''}` + (d.sets ? t('hist.customSets', { sets: d.sets }) : "");
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
        <p>${t('empty.history')}</p>
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
    const formattedStr = t('hist.dateMd', { m: parseInt(parts[1]), d: parseInt(parts[2]) });

    if (dateStr === todayStr) {
      dateDisplay = t('hist.dateToday', { date: formattedStr });
    } else if (dateStr === yesterdayStr) {
      dateDisplay = t('hist.dateYesterday', { date: formattedStr });
    } else {
      dateDisplay = t('hist.dateWithYear', { y: parts[0], date: formattedStr });
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
              <span class="history-item-title">${escapeHtml(title)}</span>
              <span class="history-item-stats">${escapeHtml(stats)}</span>
              ${item.notes ? `<span class="history-item-note">💬 ${escapeHtml(item.notes)}</span>` : ''}
            </div>
          </div>
          <div class="history-item-right">
            <button class="edit-btn" onclick="editWorkout(${inlineString(item.id)})" title="${t('hist.editRecord')}">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            </button>
            <button class="delete-btn" onclick="deleteWorkout(${inlineString(item.id)})" title="${t('hist.deleteRecord')}">
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
  if (m.arm != null) parts.push(t('prompt.bodyArm', { v: m.arm }));
  if (m.waist != null) parts.push(t('prompt.bodyWaist', { v: m.waist }));
  if (m.chest != null) parts.push(t('prompt.bodyChest', { v: m.chest }));
  if (parts.length === 0) return "";
  return t('prompt.bodyLine', { date: m.date, parts: parts.join('，') });
}

function shouldFocusOnToday(userText, mode) {
  // 「今天 / 今日 / 本次 / 刚刚」只应分析当天日志，避免旧记录在回答里喧宾夺主。
  return mode === 'analysis' && /今天|今日|当天|本次|刚才|刚刚|本日|きょう|さっき|今回/.test(userText || '');
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

  const equipmentListStr = EQUIPMENT_ROSTER.map(e => `- ${equipmentLabel(e)}：${t(e.noteKey)}`).join("\n");

  let prompt = t('prompt.summaryMain', {
    langDirective: t('prompt.langDirective', { lang: aiReplyLanguage() }),
    equipment: equipmentListStr,
    weight: weight,
    bodyMetrics: buildBodyMetricsPromptLine(),
    scope: focusToday ? t('prompt.scopeToday', { date: getLocalDateString() }) : t('prompt.scopeRecent')
  });

  if (recentWorkouts.length === 0) {
    prompt += t('prompt.noRecords');
  } else {
    recentWorkouts.forEach((w, index) => {
      // 项目名带上所属分类，例如「レッグプレス (筋トレ)」，让 AI 一眼看出练的是哪一类
      const project = LOG_PROJECTS.find(p => p.type === w.type);
      const typeStr = project ? `${typeName(w.type)} (${t(project.tagKey)})` : t('cat.other');

      let detailsStr = "";
      if (WEIGHTED_STRENGTH.includes(w.type)) {
        detailsStr = getStrengthGroups(w.details).map(g => t('hist.strengthGroup', { weight: g.weight, reps: g.reps, sets: g.sets })
          + (g.extraReps ? t('hist.extraSuffix', { n: g.extraReps }) : "")).join("；");
      } else if (w.type === 'situps') {
        detailsStr = t('hist.repsSets', { reps: w.details.reps, sets: w.details.sets })
          + (w.details.extraReps ? t('hist.extraSuffix', { n: w.details.extraReps }) : "");
      } else if (w.type === 'spin_bike') {
        detailsStr = w.details.variableSpeed
          ? t('hist.bikeVar', { time: w.details.time, summary: formatVariableSummary(w.details, t('unit.gear')) })
          : t('hist.bikePlain', { resistance: w.details.resistance + t('unit.gear'), time: w.details.time });
      } else if (w.type === 'treadmill') {
        detailsStr = w.details.variableSpeed
          ? t('hist.tmVar', { time: w.details.time, incline: w.details.incline || 0, distance: w.details.distance, calories: w.details.calories, summary: formatVariableSummary(w.details, 'km/h') })
          : `${w.details.mode === "walk" ? t('hist.walk') : t('hist.jog')} · ` + t('hist.tmPlain', { time: w.details.time, speed: w.details.speed, incline: w.details.incline, distance: w.details.distance, calories: w.details.calories });
      } else if (w.type === 'massage_chair') {
        detailsStr = t('prompt.dtMassage', { mode: massageModeLabel(w.details.mode), duration: w.details.duration, intensity: w.details.intensity });
      } else if (w.type === 'custom') {
        detailsStr = t('prompt.dtCustom', {
          name: w.details.name, value: w.details.value,
          sets: w.details.sets ? t('prompt.dtCustomSets', { sets: w.details.sets }) : ""
        });
      }

      prompt += t('prompt.recordLine', {
        i: index + 1, date: w.date, type: typeStr, details: detailsStr,
        notes: w.notes ? t('prompt.notesPart', { notes: w.notes }) : ""
      });
    });
  }

  prompt += focusToday ? t('prompt.tailToday') : t('prompt.tailRecent');
  prompt += t('prompt.tailCommon');

  return prompt;
}

// ==========================================================================
// 7.1 "Gemini的推荐" 首页模块：解析 AI 结构化训练计划、渲染、完成/拒绝
// ==========================================================================

// 只有直连 API 模式才能拿到可解析的回复，这里教会 AI 在"给出具体训练菜单推荐"时，
// 在人类可读的回复末尾追加一段机器可读的 JSON 计划块，方便一键转为打卡记录
function buildStructuredPlanInstruction() {
  return t('prompt.planInstruction');
}

// 从 AI 回复文本中提取结构化训练计划 JSON 块，返回清理后的正文 + 计划数组
function extractAiPlanFromReply(text) {
  const match = text.match(/<!--GYMNOTE_PLAN_START-->([\s\S]*?)<!--GYMNOTE_PLAN_END-->/);
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
  // 部位名用当前语言的展示名交给 AI，回来时再由 partKeyFromLabel 还原成内部 key
  const algoStr = Object.keys(algoValues).map(part => `  - ${partLabel(part)}: ${algoValues[part]}%`).join('\n');
  const partsListStr = Object.keys(RECOVERY_HOURS).map(partLabel).join('、');

  return t('prompt.recoveryInstruction', { algo: algoStr, parts: partsListStr });
}

// 从 AI 回复文本中提取结构化恢复分析块，返回清理后的正文 + 校验过的恢复数据 (无效时为 null)
function extractAiRecoveryFromReply(text) {
  const match = text.match(/<!--GYMNOTE_RECOVERY_START-->([\s\S]*?)<!--GYMNOTE_RECOVERY_END-->/);
  if (!match) return { cleanedText: text, recovery: null };

  const cleanedText = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim();
  let recovery = null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.parts)) {
      const validParts = parsed.parts
        .map(p => (p && typeof p.part === 'string') ? Object.assign({}, p, { part: partKeyFromLabel(p.part) }) : p)
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
  localStorage.setItem("gymnote_recovery_ai", JSON.stringify({
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
    label: typeof item.label === 'string' && item.label ? item.label : t('ai.recommendTitle'),
    intensity: typeof item.intensity === 'string' ? item.intensity : '',
    details: (item.details && typeof item.details === 'object') ? item.details : null,
    createdAt: now
  })).filter(item => item.label);

  if (added.length === 0) return;

  state.aiRecommendations = state.aiRecommendations.concat(added);
  localStorage.setItem("gymnote_ai_recommendations", JSON.stringify(state.aiRecommendations));
  renderAiRecommendations();
}

function recommendationNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function formatRecommendationGroup(group) {
  const weight = roundToNearestStep(recommendationNumber(group.weight), WEIGHT_STEP_KG);
  const reps = recommendationNumber(group.reps);
  const sets = recommendationNumber(group.sets);
  const extra = recommendationNumber(group.extraReps);
  return t('rec.groupFmt', { weight, reps, sets, extra: extra ? t('rec.extraSuffix', { n: extra }) : '' });
}

function formatRecommendationVariableSegment(segment, unit) {
  return t('rec.segFmt', { speed: recommendationNumber(segment.speed), unit, dur: recommendationNumber(segment.duration) });
}

// 推荐卡直接展示结构化数据，不能让用户只能依赖 AI 的一句备注理解计划。
function renderRecommendationDetails(rec) {
  const d = rec.details && typeof rec.details === 'object' ? rec.details : {};
  if (WEIGHTED_STRENGTH.includes(rec.type)) {
    const groups = getStrengthGroups(d);
    if (groups.length) {
      return `<div class="ai-rec-structure">${groups.map((group, index) => `
        <div class="ai-rec-structure-row"><b>${t('log.groupN', { n: index + 1 })}</b><span>${formatRecommendationGroup(group)}</span></div>
      `).join('')}</div>`;
    }
  }

  if ((rec.type === 'treadmill' || rec.type === 'spin_bike') && d.variableSpeed) {
    const unit = rec.type === 'treadmill' ? 'km/h' : t('unit.gear');
    const rows = [];
    if (d.warmup && recommendationNumber(d.warmup.duration) > 0) rows.push([t('ai.warmup'), formatRecommendationVariableSegment(d.warmup, unit)]);
    (Array.isArray(d.segments) ? d.segments : []).forEach((segment, index) => rows.push([t('rec.segN', { n: index + 1 }), formatRecommendationVariableSegment(segment, unit)]));
    if (d.sprint && recommendationNumber(d.sprint.duration) > 0) rows.push([t('ai.sprint'), formatRecommendationVariableSegment(d.sprint, unit)]);
    const meta = t('rec.metaTime', { time: recommendationNumber(d.time) })
      + (rec.type === 'treadmill' ? t('rec.metaIncline', { incline: recommendationNumber(d.incline) }) : '');
    return `<div class="ai-rec-structure">
      <div class="ai-rec-structure-summary">${t('rec.varSummary', { meta })}</div>
      ${rows.map(([label, value]) => `<div class="ai-rec-structure-row"><b>${label}</b><span>${value}</span></div>`).join('')}
    </div>`;
  }

  return '';
}

// 渲染首页 AI 教练推荐模块；没有待处理推荐时整个模块隐藏，避免占用首页空间
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
          <span class="ai-rec-title">${escapeHtml(rec.label)}</span>
          ${rec.intensity ? `<span class="ai-rec-intensity">${escapeHtml(rec.intensity)}</span>` : ''}
          ${renderRecommendationDetails(rec)}
        </div>
      </div>
      <div class="ai-rec-actions">
        <button class="ai-rec-btn ai-rec-accept" onclick="acceptAiRecommendation(${inlineString(rec.id)})" title="${t('ai.recComplete')}">${t('rec.btnDone')}</button>
        <button class="ai-rec-btn ai-rec-adjust" onclick="openAdjustRecDialog(${inlineString(rec.id)})" title="${t('ai.recAdjust')}">${t('rec.btnAdjust')}</button>
        <button class="ai-rec-btn ai-rec-reject" onclick="rejectAiRecommendation(${inlineString(rec.id)})" title="${t('ai.recReject')}">${t('rec.btnReject')}</button>
      </div>
    </div>
  `).join('');
}

// ==========================================================================
// 7.3 调整 AI 推荐：完成前允许修改强度(重量)/组数/组外次数等参数
// ==========================================================================
let adjustingRecId = null;
let adjustStrengthGroups = [];
let adjustVariableSegments = [];

// 力量类项目 (含重量) 统一走这一套字段；默认配重只能以 5kg 为单位，
// 所以这里的步进器只给 ±5，不提供 ±1，从 UI 层面就避免调出不合法的重量
function buildStrengthAdjustFields(d) {
  adjustStrengthGroups = getStrengthGroups(d).map(group => ({
    weight: roundToNearestStep(group.weight, WEIGHT_STEP_KG),
    reps: recommendationNumber(group.reps, 12),
    sets: recommendationNumber(group.sets, 3),
    extraReps: recommendationNumber(group.extraReps)
  }));
  if (!adjustStrengthGroups.length) adjustStrengthGroups = [{ weight: WEIGHT_STEP_KG, reps: 12, sets: 3, extraReps: 0 }];
  return `<p class="settings-desc adjust-help">${t('rec.adjustHelp')}</p>
    <div id="adjust-strength-groups"></div>
    <button type="button" class="add-group-btn" onclick="addAdjustStrengthGroup()">${t('rec.addGroup')}</button>`;
}

function renderAdjustStrengthGroups() {
  const container = document.getElementById('adjust-strength-groups');
  if (!container) return;
  const multi = adjustStrengthGroups.length > 1;
  container.innerHTML = adjustStrengthGroups.map((group, index) => `
    <div class="strength-group adjust-strength-group">
      <div class="sg-head"><span class="sg-title">${t('log.groupN', { n: index + 1 })}</span>${multi ? `<button type="button" class="sg-remove" onclick="removeAdjustStrengthGroup(${index})">${t('common.remove')}</button>` : ''}</div>
      <div class="form-row"><label>${t('log.weightKg')} <small>${t('rec.weightHint')}</small></label>
        <div class="stepper-input"><button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sg-weight-${index}', -${WEIGHT_STEP_KG})">-5</button><input type="number" id="adjust-sg-weight-${index}" value="${roundToNearestStep(group.weight, WEIGHT_STEP_KG)}" min="0" max="300" step="${WEIGHT_STEP_KG}"><button type="button" class="step-btn increase" onclick="adjustValue('adjust-sg-weight-${index}', ${WEIGHT_STEP_KG})">+5</button></div>
      </div>
      <div class="form-row-grid">
        <div class="form-row"><label>${t('log.repsPerSet')}</label><div class="stepper-input"><button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sg-reps-${index}', -1)">-</button><input type="number" id="adjust-sg-reps-${index}" value="${recommendationNumber(group.reps, 12)}" min="1" max="100"><button type="button" class="step-btn increase" onclick="adjustValue('adjust-sg-reps-${index}', 1)">+</button></div></div>
        <div class="form-row"><label>${t('log.sets')}</label><div class="stepper-input"><button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sg-sets-${index}', -1)">-</button><input type="number" id="adjust-sg-sets-${index}" value="${recommendationNumber(group.sets, 3)}" min="1" max="20"><button type="button" class="step-btn increase" onclick="adjustValue('adjust-sg-sets-${index}', 1)">+</button></div></div>
      </div>
      <div class="form-row"><label>${t('log.extraReps')} <small>${t('common.optionalSuffix')}</small></label><div class="stepper-input"><button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sg-extra-${index}', -1)">-</button><input type="number" id="adjust-sg-extra-${index}" value="${recommendationNumber(group.extraReps) || ''}" placeholder="0" min="0" max="100"><button type="button" class="step-btn increase" onclick="adjustValue('adjust-sg-extra-${index}', 1)">+</button></div></div>
    </div>`).join('');
}

function readAdjustStrengthGroups() {
  adjustStrengthGroups = adjustStrengthGroups.map((_, index) => ({
    weight: roundToNearestStep(document.getElementById(`adjust-sg-weight-${index}`).value, WEIGHT_STEP_KG),
    reps: parseInt(document.getElementById(`adjust-sg-reps-${index}`).value) || 0,
    sets: parseInt(document.getElementById(`adjust-sg-sets-${index}`).value) || 0,
    extraReps: parseInt(document.getElementById(`adjust-sg-extra-${index}`).value) || 0
  }));
}

function addAdjustStrengthGroup() {
  readAdjustStrengthGroups();
  const last = adjustStrengthGroups[adjustStrengthGroups.length - 1] || { weight: WEIGHT_STEP_KG, reps: 12, sets: 3, extraReps: 0 };
  adjustStrengthGroups.push({ ...last });
  renderAdjustStrengthGroups();
}

function removeAdjustStrengthGroup(index) {
  readAdjustStrengthGroups();
  adjustStrengthGroups.splice(index, 1);
  if (!adjustStrengthGroups.length) adjustStrengthGroups.push({ weight: WEIGHT_STEP_KG, reps: 12, sets: 3, extraReps: 0 });
  renderAdjustStrengthGroups();
}

function buildSitupsAdjustFields(d) {
  return `
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('log.repsPerSet')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-reps', -5)">-5</button>
          <input type="number" id="adjust-reps" value="${d.reps || 15}" min="1" max="200">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-reps', 5)">+5</button>
        </div>
      </div>
      <div class="form-row">
        <label>${t('log.sets')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-sets', -1)">-</button>
          <input type="number" id="adjust-sets" value="${d.sets || 3}" min="1" max="20">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-sets', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>${t('log.extraReps')} <small>${t('common.optionalSuffix')}</small></label>
      <div class="stepper-input">
        <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-extra-reps', -1)">-</button>
        <input type="number" id="adjust-extra-reps" value="${d.extraReps || ''}" placeholder="0" min="0" max="200">
        <button type="button" class="step-btn increase" onclick="adjustValue('adjust-extra-reps', 1)">+</button>
      </div>
    </div>
  `;
}

function buildVariableCardioAdjustFields(type, d) {
  const isTreadmill = type === 'treadmill';
  const unit = isTreadmill ? 'km/h' : t('unit.gear');
  const speedStep = isTreadmill ? 0.5 : 1;
  adjustVariableSegments = Array.isArray(d.segments) && d.segments.length
    ? d.segments.map(segment => ({ speed: recommendationNumber(segment.speed), duration: recommendationNumber(segment.duration) }))
    : [{ speed: isTreadmill ? 6 : 8, duration: 5 }];
  const warmup = d.warmup || {};
  const sprint = d.sprint || {};
  return `
    <p class="settings-desc adjust-help">${t('rec.varHelp')}</p>
    ${isTreadmill ? `<div class="form-row"><label>${t('log.incline')}</label><div class="stepper-input"><button type="button" class="step-btn decrease" onclick="adjustValue('adjust-vs-incline', -1)">-</button><input type="number" id="adjust-vs-incline" value="${recommendationNumber(d.incline)}" min="0" max="15"><button type="button" class="step-btn increase" onclick="adjustValue('adjust-vs-incline', 1)">+</button></div></div>` : ''}
    <div class="var-sub-title">${t('ai.warmup')} <small>${t('rec.sectionHintZero')}</small></div>
    <div class="var-seg-fields"><div class="form-row"><label>${t('log.speed')} (${unit})</label><input type="number" id="adjust-vs-warmup-speed" value="${recommendationNumber(warmup.speed)}" min="0" max="${isTreadmill ? 20 : 24}" step="${speedStep}"></div><div class="form-row"><label>${t('log.duration')}</label><input type="number" id="adjust-vs-warmup-dur" value="${recommendationNumber(warmup.duration)}" min="0" max="180"></div></div>
    <div class="var-sub-title">${t('log.segmentsTitle')}</div><div id="adjust-variable-segments"></div><button type="button" class="add-group-btn" onclick="addAdjustVariableSegment('${type}')">${t('rec.addSegment')}</button>
    <div class="var-sub-title">${t('ai.sprint')} <small>${t('rec.sectionHintZero')}</small></div>
    <div class="var-seg-fields"><div class="form-row"><label>${t('log.speed')} (${unit})</label><input type="number" id="adjust-vs-sprint-speed" value="${recommendationNumber(sprint.speed)}" min="0" max="${isTreadmill ? 20 : 24}" step="${speedStep}"></div><div class="form-row"><label>${t('log.duration')}</label><input type="number" id="adjust-vs-sprint-dur" value="${recommendationNumber(sprint.duration)}" min="0" max="180"></div></div>
    <div class="form-row"><label>${t('log.totalTime')}</label><input type="number" id="adjust-vs-time" value="${recommendationNumber(d.time)}" min="1" max="180"></div>
  `;
}

function renderAdjustVariableSegments(type) {
  const container = document.getElementById('adjust-variable-segments');
  if (!container) return;
  const isTreadmill = type === 'treadmill';
  const unit = isTreadmill ? 'km/h' : t('unit.gear');
  const speedStep = isTreadmill ? 0.5 : 1;
  container.innerHTML = adjustVariableSegments.map((segment, index) => `
    <div class="var-seg"><div class="var-seg-fields"><div class="form-row"><label>${t('log.segmentLabel', { n: index + 1, unit })}</label><input type="number" id="adjust-vs-speed-${index}" value="${recommendationNumber(segment.speed)}" min="0" max="${isTreadmill ? 20 : 24}" step="${speedStep}"></div><div class="form-row"><label>${t('log.duration')}</label><input type="number" id="adjust-vs-dur-${index}" value="${recommendationNumber(segment.duration)}" min="1" max="180"></div></div>${adjustVariableSegments.length > 1 ? `<button type="button" class="sg-remove" onclick="removeAdjustVariableSegment('${type}', ${index})">${t('common.remove')}</button>` : ''}</div>`).join('');
}

function readAdjustVariableSegments() {
  adjustVariableSegments = adjustVariableSegments.map((_, index) => ({
    speed: parseFloat(document.getElementById(`adjust-vs-speed-${index}`).value) || 0,
    duration: parseFloat(document.getElementById(`adjust-vs-dur-${index}`).value) || 0
  }));
}

function addAdjustVariableSegment(type) {
  readAdjustVariableSegments();
  const last = adjustVariableSegments[adjustVariableSegments.length - 1] || { speed: type === 'treadmill' ? 6 : 8, duration: 5 };
  adjustVariableSegments.push({ ...last });
  renderAdjustVariableSegments(type);
}

function removeAdjustVariableSegment(type, index) {
  readAdjustVariableSegments();
  adjustVariableSegments.splice(index, 1);
  if (!adjustVariableSegments.length) adjustVariableSegments.push({ speed: type === 'treadmill' ? 6 : 8, duration: 5 });
  renderAdjustVariableSegments(type);
}

function buildSpinBikeAdjustFields(d) {
  return `
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('log.resistance')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-resistance', -1)">-</button>
          <input type="number" id="adjust-resistance" value="${d.resistance || 8}" min="1" max="24">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-resistance', 1)">+</button>
        </div>
      </div>
      <div class="form-row">
        <label>${t('log.bikeTime')}</label>
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
      <label>${t('log.exerciseMode')}</label>
      <div class="segmented-control">
        <label class="segment-item">
          <input type="radio" name="adjust-treadmill-mode" value="walk" ${mode === 'walk' ? 'checked' : ''}>
          <span>${t('log.tmWalk')}</span>
        </label>
        <label class="segment-item">
          <input type="radio" name="adjust-treadmill-mode" value="run" ${mode === 'run' ? 'checked' : ''}>
          <span>${t('log.tmRun')}</span>
        </label>
      </div>
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('log.speedKmh')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-speed', -0.5)">-</button>
          <input type="number" id="adjust-speed" value="${d.speed || 6}" min="2" max="20" step="0.5">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-speed', 0.5)">+</button>
        </div>
      </div>
      <div class="form-row">
        <label>${t('log.incline')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-incline', -1)">-</button>
          <input type="number" id="adjust-incline" value="${d.incline || 0}" min="0" max="15">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-incline', 1)">+</button>
        </div>
      </div>
    </div>
    <div class="form-row">
      <label>${t('log.duration')}</label>
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
      <label>${t('log.massageMode')}</label>
      <input type="text" id="adjust-massage-mode" value="${massageModeLabel(d.mode || MASSAGE_MODES[0])}" class="glass-input">
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('rec.massageDurationMin')}</label>
        <div class="stepper-input">
          <button type="button" class="step-btn decrease" onclick="adjustValue('adjust-duration', -15)">-15</button>
          <input type="number" id="adjust-duration" value="${d.duration || 30}" min="15" max="120">
          <button type="button" class="step-btn increase" onclick="adjustValue('adjust-duration', 15)">+15</button>
        </div>
      </div>
      <div class="form-row">
        <label>${t('rec.massageIntensityHint')}</label>
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
      <label>${t('rec.itemName')}</label>
      <input type="text" id="adjust-custom-name" value="${rec.label || ''}" class="glass-input">
    </div>
    <div class="form-row-grid">
      <div class="form-row">
        <label>${t('log.customValue')}</label>
        <input type="text" id="adjust-custom-value" value="${(d && d.value) || rec.intensity || ''}" class="glass-input">
      </div>
      <div class="form-row">
        <label>${t('log.customSets')}</label>
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
    renderAdjustStrengthGroups();
  } else if (rec.type === 'situps') {
    fieldsContainer.innerHTML = buildSitupsAdjustFields(d);
  } else if (rec.type === 'spin_bike') {
    fieldsContainer.innerHTML = d.variableSpeed ? buildVariableCardioAdjustFields(rec.type, d) : buildSpinBikeAdjustFields(d);
    if (d.variableSpeed) renderAdjustVariableSegments(rec.type);
  } else if (rec.type === 'treadmill') {
    fieldsContainer.innerHTML = d.variableSpeed ? buildVariableCardioAdjustFields(rec.type, d) : buildTreadmillAdjustFields(d);
    if (d.variableSpeed) renderAdjustVariableSegments(rec.type);
  } else if (rec.type === 'massage_chair') {
    fieldsContainer.innerHTML = buildMassageChairAdjustFields(d);
  } else {
    fieldsContainer.innerHTML = buildCustomAdjustFields(rec, d);
  }

  document.getElementById("adjust-rec-dialog-title").textContent = t('rec.dialogTitle', { label: rec.label });
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
    readAdjustStrengthGroups();
    const groups = adjustStrengthGroups.filter(group => group.reps > 0 && group.sets > 0);
    if (!groups.length) {
      alert(t('msg.needValidGroupRec'));
      return;
    }
    rec.details = { groups };
    rec.intensity = groups.map(formatRecommendationGroup).join(' + ');
  } else if (rec.type === 'situps') {
    const reps = parseInt(document.getElementById("adjust-reps").value) || 0;
    const sets = parseInt(document.getElementById("adjust-sets").value) || 0;
    const extraReps = parseInt(document.getElementById("adjust-extra-reps").value) || 0;
    rec.details = { reps, sets, extraReps };
    rec.intensity = t('hist.repsSets', { reps, sets }) + (extraReps ? t('rec.extraSuffix', { n: extraReps }) : "");
  } else if (rec.type === 'spin_bike') {
    if (document.getElementById('adjust-variable-segments')) {
      readAdjustVariableSegments();
      const warmup = { speed: parseFloat(document.getElementById('adjust-vs-warmup-speed').value) || 0, duration: parseFloat(document.getElementById('adjust-vs-warmup-dur').value) || 0 };
      const sprint = { speed: parseFloat(document.getElementById('adjust-vs-sprint-speed').value) || 0, duration: parseFloat(document.getElementById('adjust-vs-sprint-dur').value) || 0 };
      const time = parseFloat(document.getElementById('adjust-vs-time').value) || 0;
      const partsSum = warmup.duration + adjustVariableSegments.reduce((sum, segment) => sum + segment.duration, 0) + sprint.duration;
      if (time <= 0 || partsSum <= 0) { alert(t('msg.needValidSegments')); return; }
      rec.details = { variableSpeed: true, warmup, segments: adjustVariableSegments, sprint, time };
      rec.intensity = t('rec.intensityBikeVar', { time, summary: formatVariableSummary(rec.details, t('unit.gear')) });
    } else {
      const resistance = parseInt(document.getElementById("adjust-resistance").value) || 0;
      const time = parseInt(document.getElementById("adjust-time").value) || 0;
      rec.details = { resistance, time };
      rec.intensity = t('rec.intensityBike', { resistance: resistance + t('unit.gear'), time });
    }
  } else if (rec.type === 'treadmill') {
    if (document.getElementById('adjust-variable-segments')) {
      readAdjustVariableSegments();
      const incline = parseFloat(document.getElementById('adjust-vs-incline').value) || 0;
      const warmup = { speed: parseFloat(document.getElementById('adjust-vs-warmup-speed').value) || 0, duration: parseFloat(document.getElementById('adjust-vs-warmup-dur').value) || 0 };
      const sprint = { speed: parseFloat(document.getElementById('adjust-vs-sprint-speed').value) || 0, duration: parseFloat(document.getElementById('adjust-vs-sprint-dur').value) || 0 };
      const time = parseFloat(document.getElementById('adjust-vs-time').value) || 0;
      const partsSum = warmup.duration + adjustVariableSegments.reduce((sum, segment) => sum + segment.duration, 0) + sprint.duration;
      if (time <= 0 || partsSum <= 0) { alert(t('msg.needValidSegments')); return; }
      const estimate = computeVariableTreadmill(incline, warmup, adjustVariableSegments, sprint, time);
      rec.details = { variableSpeed: true, incline, warmup, segments: adjustVariableSegments, sprint, time, distance: estimate.distance, calories: estimate.calories };
      rec.intensity = t('rec.intensityTmVar', { time, incline, summary: formatVariableSummary(rec.details, 'km/h') });
    } else {
      const mode = document.querySelector('input[name="adjust-treadmill-mode"]:checked').value;
      const speed = parseFloat(document.getElementById("adjust-speed").value) || 0;
      const incline = parseFloat(document.getElementById("adjust-incline").value) || 0;
      const time = parseInt(document.getElementById("adjust-time").value) || 0;
      rec.details = { mode, speed, incline, time };
      rec.intensity = t('rec.intensityTm', { mode: mode === 'walk' ? t('hist.walk') : t('hist.jog'), time, speed, incline });
    }
  } else if (rec.type === 'massage_chair') {
    const mode = document.getElementById("adjust-massage-mode").value.trim() || MASSAGE_MODES[0];
    const duration = parseInt(document.getElementById("adjust-duration").value) || 30;
    const intensity = parseInt(document.getElementById("adjust-intensity").value) || 2;
    rec.details = { mode, duration, intensity };
    rec.intensity = t('rec.intensityMassage', { mode, duration, intensity });
  } else {
    const name = document.getElementById("adjust-custom-name").value.trim() || rec.label;
    const value = document.getElementById("adjust-custom-value").value.trim();
    const sets = parseInt(document.getElementById("adjust-custom-sets").value) || null;
    rec.label = name;
    rec.details = { name, value, sets };
    rec.intensity = value + (sets ? t('prompt.dtCustomSets', { sets }) : "");
  }

  localStorage.setItem("gymnote_ai_recommendations", JSON.stringify(state.aiRecommendations));
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
    // 变速有氧和普通有氧的字段不同，不能拿普通 speed/resistance schema 把变速计划降级成自定义项目。
    const isVariableCardio = (type === 'treadmill' || type === 'spin_bike') && details && details.variableSpeed;
    const valid = isVariableCardio
      ? recommendationNumber(details.time) > 0 && Array.isArray(details.segments) && details.segments.some(segment => recommendationNumber(segment.duration) > 0)
      : details && WORKOUT_REQUIRED_FIELDS[type].every(f => details[f] !== undefined && details[f] !== null && details[f] !== '');
    if (!valid) type = 'custom';
  }

  if (type === 'custom') {
    details = {
      name: rec.label || t('cat.customFull'),
      value: rec.intensity || '',
      sets: (details && details.sets) || null
    };
  } else if (type === 'treadmill') {
    // 距离/卡路里统一由 App 按同一套公式计算，不采信 AI 自行估算的数值，保证口径一致
    const est = details.variableSpeed
      ? computeVariableTreadmill(details.incline, details.warmup || {}, details.segments || [], details.sprint || {}, details.time)
      : computeTreadmillEstimate(details.mode, details.speed, details.incline, details.time);
    details.distance = est.distance;
    details.calories = est.calories;
  }

  const newWorkout = {
    id: "workout-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
    date: getLocalDateString(),
    type: type,
    details: details,
    notes: t('ai.recFrom', { provider: getAiCoachName() }) + (rec.intensity ? `：${rec.intensity}` : "")
  };

  state.workouts.unshift(newWorkout);
  localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));

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
  localStorage.setItem("gymnote_ai_recommendations", JSON.stringify(state.aiRecommendations));
  localStorage.setItem("gymnote_deleted", JSON.stringify(state.deletedIds));
}

// 生成新一轮训练菜单时，替换掉所有尚未处理的旧推荐（而不是无限堆积）。
// 被替换掉的旧条目也要打墓碑，避免云端合并时被旧数据带回来
function setAiRecommendations(rawItems) {
  const now = Date.now();
  state.aiRecommendations.forEach(rec => { state.deletedIds[rec.id] = now; });
  localStorage.setItem("gymnote_deleted", JSON.stringify(state.deletedIds));

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
      alert(t('msg.copySuccess'));
      closePromptDialog();
    });
  } catch (err) {
    // 兼容性降级处理
    document.execCommand("copy");
    alert(t('msg.copySuccessFallback'));
    closePromptDialog();
  }
}

// ==========================================================================
// 7.2 AI 多会话聊天记录 (Chat Sessions，仿主流 AI 聊天 App 的历史对话)
//     三种聊天模式：聊天(chat) / 训练菜单(menu) / 身体分析(analysis)
// ==========================================================================
// 注意：欢迎语会经过 formatChatMessageText 处理 (先转义 HTML 再解析 **粗体**/换行)，
// 所以只能写 Markdown 语法，不能直接写 <strong>/<br> 这类 HTML 标签，否则会被转义显示成字面文字
// 文案全部走 i18n，这里只保留模式与词条 key 的对应关系
const AI_MODES = {
  chat: {
    labelKey: 'ai.modeChat', icon: '💬',
    placeholderKey: 'ai.inputPlaceholderChat',
    quickActionKey: 'ai.quickActionChat',
    welcomeKey: 'ai.welcomeChat'
  },
  menu: {
    labelKey: 'ai.modeMenu', icon: '📋',
    placeholderKey: 'ai.inputPlaceholderMenu',
    quickActionKey: 'ai.quickActionMenu',
    welcomeKey: 'ai.welcomeMenu'
  },
  analysis: {
    labelKey: 'ai.modeAnalysis', icon: '🩺',
    placeholderKey: 'ai.inputPlaceholderAnalysis',
    quickActionKey: 'ai.quickActionAnalysis',
    welcomeKey: 'ai.welcomeAnalysis'
  }
};

// 模式的展示名（带图标），用于工具栏徽章与会话列表
function aiModeLabel(mode) {
  const conf = AI_MODES[mode] || AI_MODES.chat;
  return `${conf.icon} ${t(conf.labelKey)}`;
}

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
  if (badge) badge.textContent = aiModeLabel(currentAiMode || 'chat');
  const input = document.getElementById("chat-input");
  if (input) input.placeholder = t(conf.placeholderKey);
  const quickBtn = document.getElementById("ai-quick-action");
  if (quickBtn) quickBtn.textContent = t(conf.quickActionKey);
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
  localStorage.setItem("gymnote_chat_sessions", JSON.stringify(state.chatSessions));
  localStorage.setItem("gymnote_active_chat_session", state.activeChatSessionId || "");
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
  if (!firstUserMsg) return t('ai.newSession');
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
  if (!confirm(t('msg.confirmDeleteChat'))) return;

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
    list.innerHTML = `<div class="chat-history-empty">${t('ai.historyEmpty')}</div>`;
    return;
  }

  const sorted = [...state.chatSessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const modeBadges = { chat: '💬', menu: '📋', analysis: '🩺' };
  list.innerHTML = sorted.map(session => {
    const isActive = session.id === state.activeChatSessionId;
    const lastMsg = session.messages[session.messages.length - 1];
    const timeStr = lastMsg ? new Date(lastMsg.time || session.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '';
    return `
      <div class="chat-history-item ${isActive ? 'active' : ''}" onclick="switchChatSession(${inlineString(session.id)})">
        <div class="chat-history-item-title">${modeBadges[getSessionMode(session)] || '💬'} ${escapeHtml(getSessionTitle(session))}</div>
        <div class="chat-history-item-meta">
          <span>${timeStr}</span>
          <button class="chat-history-delete-btn" onclick="deleteChatSession(${inlineString(session.id)}, event)" title="${t('common.delete')}">🗑</button>
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
    appendMessage("ai", getAiCoachName(), t(conf.welcomeKey), false, false);
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
    alert(t('ai.needKeyMenu', { keyLabel: AI_PROVIDERS[getAiProvider()].keyLabel }));
    switchTab('settings');
    return;
  }

  const userText = t('ai.askMenu');
  await callAiCoach(userText, { mode: 'menu' });
}

// "一键分析恢复状况"：身体分析模式的快捷入口
async function requestBodyAnalysis() {
  if (!getActiveApiKey()) {
    alert(t('ai.needKeyAnalysis', { keyLabel: AI_PROVIDERS[getAiProvider()].keyLabel }));
    switchTab('settings');
    return;
  }

  const userText = t('ai.askAnalysis');
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
    const msg = (data.error && data.error.message) || t('err.claude');
    throw new Error(msg);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error(t('err.claudeSafety'));
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
    throw new Error((data.error && data.error.message) || t('err.openai'));
  }
  const text = data.output_text || (data.output || [])
    .filter(item => item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
  if (!text) throw new Error(t('err.openaiEmpty'));
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
    const msg = data.error ? data.error.message : t('err.gemini');
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
  appendMessage("user", t('ai.you'), userText);

  // 2. 检测 API Key 是否配置
  if (!apiKey) {
    setTimeout(() => {
      appendMessage("ai", coachName, t('ai.noKeyGuide', { keyLabel: conf.keyLabel }));
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
    : [{ role: 'user', name: t('ai.you'), text: userText }];

  // 5. 显示 AI 正在思考 (Typing...)
  const pendingText = mode === 'menu' ? t('ai.loadingMenu')
    : mode === 'analysis' ? t('ai.loadingAnalysis')
    : t('ai.loadingThinking');
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
        displayText += t('ai.planPushed', { n: items.length });
      }
    } else if (mode === 'analysis') {
      const { cleanedText, recovery } = extractAiRecoveryFromReply(rawReplyText);
      displayText = cleanedText;
      if (recovery) {
        applyAiRecoveryAnalysis(recovery);
        displayText += t('ai.recoveryPushed');
      }
    } else {
      displayText = extractAiPlanFromReply(rawReplyText).cleanedText;
    }

    appendMessage("ai", coachName, displayText);
  } catch (error) {
    removeMessage(tempBubbleId);
    appendMessage("ai", coachName, t('ai.errorPrefix', { msg: error.message }));
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
    modelSel.innerHTML = conf.models.map(m => `<option value="${m.id}">${t(m.nameKey)}</option>`).join("");
    const wanted = conf.models.some(m => m.id === state.settings.apiModel) ? state.settings.apiModel : conf.defaultModel;
    modelSel.value = wanted;
  }

  const hint = document.getElementById("setting-api-hint");
  if (hint) hint.innerHTML = t(conf.hintKey);
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

  localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));

  refreshSyncStatusLabel();
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
  a.download = `gymnote_workout_backup_${dateStr}.json`;
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
        localStorage.setItem("gymnote_deleted", JSON.stringify(state.deletedIds));

        // 转回数组并按日期从新到旧排序
        const mergedList = Array.from(mergedMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));

        state.workouts = mergedList;
        localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));
        
        // 合并身体数据（按 id 去重，本地优先）
        if (Array.isArray(data.measurements)) {
          const mMap = new Map();
          data.measurements.forEach(m => { if (m && m.id) mMap.set(m.id, m); });
          (state.measurements || []).forEach(m => { if (m && m.id) mMap.set(m.id, m); });
          state.measurements = Array.from(mMap.values()).sort((a, b) => new Date(b.date) - new Date(a.date));
          localStorage.setItem("gymnote_measurements", JSON.stringify(state.measurements));
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
          localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
          syncSettingsUI();
        }

        alert(t('msg.importSuccess'));
        // 刷新
        updateStats();
        renderHistory();
        switchTab('dashboard');
      } else {
        alert(t('msg.importInvalid'));
      }
    } catch(err) {
      alert(t('msg.importParseError'));
    }
  };
  reader.readAsText(file);
}

// 清空重置数据库 (已升级为双向同步清空：若开启了云同步，将同步清空 GitHub 云端，防止刷新后从云端重新拉回)
async function resetDatabase() {
  if (!confirm(t('msg.confirmReset1'))) {
    return;
  }
  if (!confirm(t('msg.confirmReset2'))) {
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
      resetBtn.innerHTML = t('sync.clearingCloud');
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
        const syncFile = gistDetail.files[GIST_FILE_NAME] || gistDetail.files[LEGACY_GIST_FILE_NAME];
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
            [GIST_FILE_NAME]: {
              "content": JSON.stringify({ workouts: [], recommendations: [], deleted: tombstones }, null, 2)
            }
          }
        })
      });

      if (!response.ok) {
        throw new Error(t('err.cloudUpdate'));
      }
    } catch (e) {
      console.error("Failed to clear cloud Gist: ", e);
      alert(t('err.clearCloud') + e.message);
    }
  }

  // 3. 清空本地历史/推荐/身体数据并保存墓碑，保持 has_run_before 状态，防止重新加载时写入 mock 数据
  localStorage.setItem("gymnote_workouts", JSON.stringify([]));
  localStorage.setItem("gymnote_ai_recommendations", JSON.stringify([]));
  localStorage.setItem("gymnote_measurements", JSON.stringify([]));
  localStorage.setItem("gymnote_deleted", JSON.stringify(tombstones));
  localStorage.setItem("gymnote_has_run_before", "true");

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
      alert(t('sync.needToken'));
      switchTab('settings');
    }
    return;
  }
  
  // 更新 UI 状态
  if (syncBtn) {
    syncBtn.closest(".settings-action-row").classList.add("syncing");
    syncBtn.disabled = true;
    syncBtn.querySelector("span").textContent = t('sync.syncing');
  }
  if (statusLabel) {
    statusLabel.textContent = t('sync.connecting');
    statusLabel.style.color = "var(--text-secondary)";
    statusLabel.style.textShadow = "none";
  }
  
  const headers = {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json"
  };
  
  try {
    // 1. 如果本地没有绑定 Gist ID，搜索当前或旧版文件名，避免改名后丢失云端记录。
    if (!gistId) {
      if (statusLabel) statusLabel.textContent = t('sync.searching');
      
      try {
        const gistsResponse = await fetch("https://api.github.com/gists", {
          method: "GET",
          headers: headers
        });
        
        if (gistsResponse.ok) {
          const gists = await gistsResponse.json();
          const foundGist = gists.find(g => g.files && (g.files[GIST_FILE_NAME] || g.files[LEGACY_GIST_FILE_NAME]));
          
          if (foundGist) {
            gistId = foundGist.id;
            state.settings.githubGistId = gistId;
            localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
            
            const gistInput = document.getElementById("setting-github-gist-id");
            if (gistInput) gistInput.value = gistId;
            
            if (statusLabel) statusLabel.textContent = t('sync.found');
          }
        }
      } catch (err) {
        console.warn(t('sync.searchFailed'), err);
      }
    }

    // 2. 如果云端和本地确实都没有 Gist ID，说明是首次使用，创建全新的 Gist
    if (!gistId) {
      if (statusLabel) statusLabel.textContent = t('sync.creating');
      
      const createResponse = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          description: "GymNote personal workout data",
          public: false,
          files: {
            [GIST_FILE_NAME]: {
              "content": "[]"
            }
          }
        })
      });
      
      if (!createResponse.ok) {
        throw new Error(t('sync.errCreateGist', { status: createResponse.statusText, code: createResponse.status }));
      }
      
      const gistData = await createResponse.json();
      gistId = gistData.id;
      
      // 保存本地
      state.settings.githubGistId = gistId;
      localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
      
      const gistInput = document.getElementById("setting-github-gist-id");
      if (gistInput) gistInput.value = gistId;
      
      if (statusLabel) statusLabel.textContent = t('sync.created');
    }
    
    // 2. 从云端拉取已存在的数据
    if (statusLabel) statusLabel.textContent = t('sync.pulling');
    const getResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "GET",
      headers: headers
    });
    
    if (getResponse.status === 404) {
      // 说明绑定的 Gist 已经在 GitHub 上被删除了，需要清空本地 ID 并重试
      state.settings.githubGistId = "";
      localStorage.setItem("gymnote_settings", JSON.stringify(state.settings));
      const gistInput = document.getElementById("setting-github-gist-id");
      if (gistInput) gistInput.value = "";
      throw new Error(t('sync.gistDeleted'));
    }
    
    if (!getResponse.ok) {
      throw new Error(t('sync.errFetch', { status: getResponse.statusText }));
    }
    
    const gistDetail = await getResponse.json();
    const syncFile = gistDetail.files[GIST_FILE_NAME] || gistDetail.files[LEGACY_GIST_FILE_NAME];

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
    if (statusLabel) statusLabel.textContent = t('sync.merging');
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
    localStorage.setItem("gymnote_workouts", JSON.stringify(state.workouts));
    localStorage.setItem("gymnote_ai_recommendations", JSON.stringify(state.aiRecommendations));
    localStorage.setItem("gymnote_deleted", JSON.stringify(state.deletedIds));

    // 4. 将合并后的最新数据推回云端 Gist (新格式同时携带记录、AI 推荐和删除墓碑)
    if (statusLabel) statusLabel.textContent = t('sync.uploading');
    const patchResponse = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: "PATCH",
      headers: headers,
      body: JSON.stringify({
        files: {
          [GIST_FILE_NAME]: {
            "content": JSON.stringify({ workouts: state.workouts, recommendations: state.aiRecommendations, deleted: state.deletedIds }, null, 2)
          }
        }
      })
    });
    
    if (!patchResponse.ok) {
      throw new Error(t('sync.errUpload', { status: patchResponse.statusText }));
    }
    
    // 5. 同步成功，重绘界面与状态
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
    
    if (statusLabel) {
      statusLabel.textContent = t('sync.successStatus', { n: state.workouts.length, time: timeStr });
      statusLabel.style.color = "var(--neon-green)";
      statusLabel.style.textShadow = "0 0 8px rgba(57, 255, 20, 0.3)";
    }
    
    // 刷新页面渲染
    updateStats();
    renderHistory();
    renderAiRecommendations();

    if (!isSilent) {
      alert(t('msg.syncSuccess'));
    }
    
  } catch (error) {
    console.error("Gist Sync Error: ", error);
    if (statusLabel) {
      statusLabel.textContent = t('sync.failedStatus', { msg: error.message });
      statusLabel.style.color = "var(--danger-color)";
      statusLabel.style.textShadow = "none";
    }
    if (!isSilent) {
      alert(t('sync.failedAlert', { msg: error.message }));
    }
  } finally {
    // 恢复按钮 UI
    if (syncBtn) {
      syncBtn.closest(".settings-action-row").classList.remove("syncing");
      syncBtn.disabled = false;
      syncBtn.querySelector("span").textContent = t('set.syncBtn');
    }
  }
}
