// =====================================================
// i18n: 多语言支持 (日本語 / 简体中文)
// 词典 + t() 取词 + data-i18n 静态节点替换 + 语言切换
// app.js 与 index.html 都依赖本文件，须在 app.js 之前加载
// =====================================================

const LANG_STORAGE_KEY = 'gymnote_lang';
const SUPPORTED_LANGS = ['ja', 'zh'];

// 语言检测优先级：用户已保存的选择 > 浏览器语言（中文环境用中文，其余一律日语）
function detectLang() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  } catch (e) { /* localStorage 不可用时走浏览器语言 */ }
  const nav = (navigator.language || navigator.userLanguage || '').toLowerCase();
  return nav.startsWith('zh') ? 'zh' : 'ja';
}

let CURRENT_LANG = detectLang();

function getLang() {
  return CURRENT_LANG;
}

// 取词：缺词时回退到日语词典，再缺则回显 key 本身（便于开发期发现漏翻）
// vars 支持 {name} 占位符插值
function t(key, vars) {
  const dict = I18N_DICT[CURRENT_LANG] || I18N_DICT.ja;
  let text = dict[key];
  if (text === undefined) text = I18N_DICT.ja[key];
  if (text === undefined) return key;
  if (vars) {
    Object.keys(vars).forEach(k => {
      text = text.split('{' + k + '}').join(vars[k]);
    });
  }
  return text;
}

function setLang(lang) {
  if (!SUPPORTED_LANGS.includes(lang) || lang === CURRENT_LANG) return;
  CURRENT_LANG = lang;
  try { localStorage.setItem(LANG_STORAGE_KEY, lang); } catch (e) { /* 隐私模式下忽略 */ }
  applyDocumentLang();
  applyStaticI18n();
  // app.js 定义的重绘钩子：切换语言后把所有动态渲染的视图重新生成一遍
  if (typeof onLanguageChanged === 'function') onLanguageChanged();
}

function toggleLang() {
  setLang(CURRENT_LANG === 'ja' ? 'zh' : 'ja');
}

function applyDocumentLang() {
  document.documentElement.setAttribute('lang', CURRENT_LANG === 'ja' ? 'ja' : 'zh-CN');
  document.title = t('app.title');
  const btn = document.getElementById('lang-toggle-btn');
  // 按钮显示的是"切换过去的语言"，而不是当前语言
  if (btn) {
    btn.textContent = CURRENT_LANG === 'ja' ? '中' : '日';
    btn.title = t('app.langToggle');
  }
}

// 遍历带 data-i18n* 属性的静态节点并写入当前语言文案
function applyStaticI18n(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  scope.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  // 历史筛选下拉：文案前面固定带一个 emoji 图标
  scope.querySelectorAll('[data-i18n-option]').forEach(el => {
    const emoji = el.getAttribute('data-emoji');
    el.textContent = (emoji ? emoji + ' ' : '') + t(el.getAttribute('data-i18n-option'));
  });
}

// 身体部位在数据层固定用中文作为内部 key（云同步与历史数据依赖它），
// 只在展示时翻译，避免改动存量数据结构
function partLabel(part) {
  return t('part.' + (PART_KEY_MAP[part] || 'other'));
}

const PART_KEY_MAP = {
  '腿部': 'legs', '胸部': 'chest', '背部': 'back', '肩部': 'shoulder',
  '核心': 'core', '手臂': 'arm', '有氧': 'cardio', '放松恢复': 'recovery', '其他': 'other'
};

// 反查：把 AI 回复里的部位展示名还原成内部 key。
// 也接受内部 key 本身，兼容旧数据与模型直接输出中文名的情况
function partKeyFromLabel(label) {
  if (PART_KEY_MAP[label]) return label;
  const hit = Object.keys(PART_KEY_MAP).find(key => partLabel(key) === label);
  return hit || null;
}

// AI 请求使用的语言名，写进提示词里约束模型的回复语言
function aiReplyLanguage() {
  return CURRENT_LANG === 'ja' ? '日本語' : '简体中文';
}

// =====================================================
// 词典本体。键名按区域分组：
// app./nav. 外壳  dash. 主页  log. 打卡  hist. 历史  trend. 趋势
// ai. AI教练  set. 设置  sync. 云同步  msg. 提示  err. 错误
// type. 项目  cat. 分类  part. 身体部位  metric. 体测  unit. 单位
// prompt. 发给 AI 的提示词
// =====================================================
const I18N_DICT = {

  // ---------------- 日本語 ----------------
  ja: {
    'app.title': 'GymNote トレーニング記録',
    'app.badge': 'パーソナル',
    'app.themeToggle': 'ライト / ダークモードの切り替え',
    'app.langToggle': '言語を切り替える（日本語 / 中文）',

    'nav.home': 'ホーム',
    'nav.log': '記録',
    'nav.history': '履歴',
    'nav.trends': '推移',
    'nav.ai': 'AIコーチ',
    'nav.settings': '設定',

    'common.cancel': 'キャンセル',
    'common.close': '閉じる',
    'common.edit': '編集',
    'common.delete': '削除',
    'common.remove': '削除',
    'common.today': '今日',
    'common.optional': '任意',
    'common.optionalSuffix': '—— 任意',
    'common.settings': '設定',

    // ---- 主页 / ダッシュボード ----
    'dash.hello': 'こんにちは 👋',
    'dash.helloSub': '今日も元気に、記録から始めましょう！',
    'dash.cta': '今すぐ記録',
    'dash.weeklyTitle': '今週のトレーニング頻度',
    'dash.weeklySub': '直近7日間の活動',
    'dash.trendTitle': 'トレーニング傾向の分析',
    'dash.trendSub': '直近30日の比率 / 直近4週の推移',
    'dash.legendStrength': '筋トレ+体幹 {count}回 ({pct}%)',
    'dash.legendCardio': '有酸素 {count}回 ({pct}%)',
    'dash.legendOther': 'その他 {count}回 ({pct}%)',
    'dash.miniVolume': '筋トレ総重量の推移 (kg)',
    'dash.miniCardio': '有酸素時間の推移 (分)',
    'dash.aiRecTitle': 'AIコーチのおすすめ',
    'dash.aiRecSub': 'AIコーチからのトレーニング提案',
    'dash.quickStart': 'クイックスタート',

    'dialog.adjustTitle': 'おすすめを調整',
    'dialog.saveAdjust': '調整を保存',

    // ---- 打卡 / 記録 ----
    'log.newTitle': 'トレーニングを記録',
    'log.newSub': '記録する種目を選んでください',
    'log.back': '種目一覧へ戻る',
    'log.exercise': '種目',
    'log.dateLabel': '記録する日付',
    'log.dateHint': '—— 既定は今日。過去の日付を選んで後から追加もできます',
    'log.notesLabel': 'メモ / 感想',
    'log.notesPlaceholder': 'メモを追加（例：「今日は軽かった」やマシンの番号など）',
    'log.save': 'この記録を保存',
    'log.saveEdit': '変更を保存',
    'log.weightGroup': '重量セット',
    'log.weightGroupN': '重量セット {n}',
    'log.repsPerSet': '1セットの回数',
    'log.sets': 'セット数',
    'log.extraReps': 'セット外回数',
    'log.speed': '速度',
    'log.duration': '時間 (分)',
    'log.incline': '傾斜 (%)',
    'log.totalTime': '合計時間 (分)',
    'log.segmentsTitle': 'インターバル区間',
    'log.segmentLabel': 'インターバル {n} · 速度 ({unit})',
    'log.segmentSum': '各区間の合計',
    'log.estDistance': '推定距離',
    'log.estCalories': '推定消費',
    'log.customNamePlaceholder': '種目名を入力（例：ダンベルフライ）',
    'log.customValuePlaceholder': '例：15kg / 12回',
    'log.customSetsPlaceholder': '例：3',
    'sync.errCreateGist': 'Gist の作成に失敗しました: {status} (コード: {code})',
    'sync.errFetch': 'クラウドデータの取得に失敗しました: {status}',
    'sync.errUpload': 'クラウドへのアップロードに失敗しました: {status}',
    'sync.successStatus': '同期完了（統合後 {n} 件、{time}）',
    'sync.failedStatus': '同期に失敗しました: {msg}',
    'sync.failedAlert': '❌ クラウド同期に失敗しました：{msg}',
    'ai.historyEmpty': '会話履歴はまだありません。最初のメッセージを送ると自動で作成されます',
    'ai.needKeyMenu': 'メニューの生成には、まず「設定」画面で {keyLabel} を登録する必要があります（APIキー不要の「トレーニングデータをまとめる」モードでは、おすすめリストの自動生成はできず、テキストの手動コピーのみとなります）。',
    'ai.needKeyAnalysis': '身体分析には、まず「設定」画面で {keyLabel} を登録する必要があります。',
    'ai.askMenu': '使える器具に合わせて、今日そのまま実行できる具体的なトレーニングメニューを組んでください。種目・重量・セット数など、実行可能な強度設定を含めてください。',
    'ai.askAnalysis': '私の記録データをもとに、部位ごとのトレーニング量の分布と現在の疲労回復状況を分析し、構造化された結果をアプリに送ってください。',
    'ai.planPushed': '\n\n✅ {n}件のおすすめを作成しました。ホーム画面の「AIコーチのおすすめ」から確認できます。「完了」を押すと本日の記録が自動で作成されます。',
    'ai.recoveryPushed': '\n\n✅ 分析結果を「推移」タブの疲労回復度に反映しました。',
    'ai.errorPrefix': '❌ エラーが発生しました：{msg}',
    'rec.dialogTitle': 'おすすめを調整：{label}',
    'rec.massageDurationMin': 'マッサージ時間 (分)',
    'rec.massageIntensityHint': '強さ (1弱 / 2中 / 3強)',
    'rec.itemName': '種目名',
    'rec.intensityBikeVar': 'インターバル走 {time}分：{summary}',
    'rec.intensityBike': '負荷{resistance} · {time}分',
    'rec.intensityTmVar': 'インターバル走 {time}分、傾斜{incline}%：{summary}',
    'rec.intensityTm': '{mode} {time}分、速度{speed}km/h、傾斜{incline}%',
    'rec.intensityMassage': '{mode}、{duration}分、強さ{intensity}',
    'rec.varHelp': '各インターバル区間は個別に調整できます。合計時間は各区間の合計と一致させてください。',
    'rec.sectionHintZero': '（0 可）',
    'rec.addSegment': '＋ インターバル区間を追加',
    'rec.groupFmt': '{weight}kg × {reps}回 × {sets}セット{extra}',
    'rec.extraSuffix': ' + セット外{n}回',
    'rec.segFmt': '{speed}{unit} × {dur}分',
    'rec.segN': 'インターバル {n}',
    'rec.varSummary': 'インターバル · {meta}',
    'rec.metaTime': '{time}分',
    'rec.metaIncline': ' · 傾斜{incline}%',
    'rec.btnDone': '✓ 完了',
    'rec.btnAdjust': '✎ 調整',
    'rec.btnReject': '✕ 却下',
    'rec.adjustHelp': '各重量セットは完了前に個別に調整できます。保存するとそのまま記録に反映されます。',
    'rec.addGroup': '＋ 重量セットを追加',
    'rec.weightHint': '—— 5kg 単位で調整',
    'prompt.langDirective': '回答は必ず{lang}で行ってください。',
    'prompt.bodyLine': '- 直近の身体データ ({date}): {parts}\n',
    'prompt.bodyArm': '腕囲 {v}cm',
    'prompt.bodyWaist': '腹囲 {v}cm',
    'prompt.bodyChest': '胸囲 {v}cm',
    'prompt.scopeToday': '本日（{date}）の記録のみ。過去の日付の記録を「今日のトレーニング分析」に混ぜないでください。本日の記録がない場合はその旨をはっきり伝えてください。',
    'prompt.scopeRecent': '直近30件のトレーニング記録（新しい順）。',
    'prompt.noRecords': '（記録はまだありません。トレーニングを始めたばかりなので、入門の進め方と筋トレ・有酸素の配分を指導してください）\n',
    'prompt.dtMassage': 'モード [{mode}]、{duration}分、強さ {intensity}',
    'prompt.dtCustom': '[{name}] - データ: {value}{sets}',
    'prompt.dtCustomSets': ' x {sets}セット',
    'prompt.recordLine': '{i}. 日付: {date} | 種目: {type} | 内容: {details} {notes}\n',
    'prompt.notesPart': '| メモ: "{notes}"',
    'prompt.tailToday': '\n今回の質問には「本日」の記録のみに基づいて答えてください。まず本日のトレーニングについての結論を述べ、次に追加で鍛えるべきか、休むべきか、軽い有酸素にすべきかを述べてください。過去の日付の記録を繰り返したり比較したりしないでください。',
    'prompt.tailRecent': '\n直近の記録を踏まえて今回の質問に答えてください。傾向を比較する場合は、どの日付のデータを使ったかを明示してください。',
    'prompt.tailCommon': '\n回答は直接的かつ具体的に、過度な約束はしないでください。痛み・怪我・明らかな不調に触れる場合は、追い込みを中止して専門家に相談するよう勧めてください。',
    'ai.noKeyGuide': `{keyLabel} が設定されていません。

直近のトレーニング記録と今回のご質問をまとめました。「チャット」モードに切り替えて「**トレーニングデータをまとめる**」ボタンからコピーし、お好きな AI のウェブ版に貼り付けてご質問ください。
アプリ内で直接やり取りしたい場合は、「設定」画面で {keyLabel} を入力してください。`,
    'ai.welcomeChat': `こんにちは！あなたのAIフィットネスコーチです。ここは**フリーチャットモード**です。トレーニング・食事・回復について何でも聞いてください。あなたの記録の履歴を踏まえてお答えします。

**💡 ヒント：**
1. ワンタップで記録できるメニューが欲しいときは、前の画面に戻って「トレーニングメニュー」モードを選んでください
2. 部位ごとの疲労と回復状況を知りたいときは「身体分析」モードへ
3. API キーがなくても、下の「トレーニングデータをまとめる」からプロンプトをコピーして、お好きな AI のウェブ版に貼り付けて使えます`,
    'ai.welcomeMenu': `ここは**トレーニングメニューモード**です。今日の目標・体調・使える時間を教えていただければ、そのまま実行できる具体的なメニューをお作りします。作成したメニューはホーム画面の「AIコーチのおすすめ」に自動で反映され、ワンタップで記録できます。

下の「今日のメニューを生成」を押していただければ、これまでの記録と回復状況をもとに私が組み立てます。

ご注意：新しいメニューを作ると、ホーム画面に残っている未処理のおすすめは置き換わります。`,
    'ai.welcomeAnalysis': `ここは**身体分析モード**です。最近の記録データをもとに、部位ごとのトレーニング量の偏りと疲労回復の状況を分析します。

下の「回復状況を分析」を押すと、分析結果が「推移」タブの疲労回復度に自動で反映されます（自動推定値を上書きし、私のコメントを添えます）。`,
    'prompt.summaryMain': `あなたはプロフェッショナルで親しみやすいパーソナルトレーナーです。私の最近のトレーニング成果を分析し、私に合った提案をしてください。
{langDirective}

【重要な制約：利用可能な器具リスト】
{equipment}

厳守してください：トレーニングの提案・種目の推奨は、必ず上記の器具リストの中からのみ選んでください。リストにない種目や器具に言及・推奨しないでください。目的に直接対応する器具がリストにない場合は、リストの中から機能が最も近い代替種目を選び、それが代替案であることを明記してください。

もう一点：筋力マシンの重量は 5kg 刻みでしか調整できず、2.5kg のような半段階には対応していません。したがって提案するすべての重量は 5 の倍数（20kg、25kg、30kg など）にしてください。

重要：本アプリの筋トレ記録は「同じ日の同じ種目で複数の重量セット」に対応しており、1件の記録に異なる重量のセットを複数含められます（例：ラットプルダウン 25kg×12回×3セットに加えて 30kg×8回×2セット）。メニューを提案する際は、この複数重量セット構造を活かしてください（ピラミッドセットやドロップセットなど）。有酸素（ランニングマシン／エアロバイク）は「インターバル」モードに対応しており、ウォームアップ、複数のインターバル区間（区間ごとに速度と時間）、スプリントに分けられます。必要に応じて区間ごとのペース配分を提案してください。

【私のプロフィール】
- 体重: {weight} kg
{bodyMetrics}
【今回分析するデータの範囲】
{scope}

【トレーニング記録】
`,
    'prompt.planInstruction': `
【構造化トレーニングプランの出力形式 —— 今回のリクエストは実行可能な具体的メニューの依頼なので、必ず出力してください】
人が読むための通常の回答が終わったあと、改行して、<!--GYMNOTE_PLAN_START--> と <!--GYMNOTE_PLAN_END--> で囲んだ JSON 配列を追記してください。
配列の各要素が1つの推奨種目を表し、形式は次のとおりです：
{ "type": "器具の英語ID", "label": "表示名", "intensity": "人が読むための強度の説明", "details": { ...構造化された数値フィールド } }
type は次の英語IDのいずれかで、details は対応するスキーマに厳密に一致させてください：
  - 筋トレ種目 "leg_press" / "shoulder_press" / "chest_press" / "preacher_curl" / "lat_pulldown"：
      details = { "groups": [ { "weight": 数値(5の倍数), "reps": 数値, "sets": 数値, "extraReps": 数値または0 }, ... ] }
      （groups 配列は「複数重量セット」に対応します。ピラミッド／ドロップセットにする場合は weight の異なる要素を複数入れてください。1セットだけの場合も groups に1要素入れてください）
  - "situps"：details = { "reps": 数値, "sets": 数値, "extraReps": 数値または0 }
  - "spin_bike"：details = { "resistance": 数値1-24, "time": 分数 }
  - "treadmill"：details = { "mode": "walk" または "run", "speed": km/hの数値, "incline": 傾斜の数値, "time": 分数 }
  - "massage_chair"：details = { "mode": 文字列, "duration": 分数, "intensity": 1/2/3 }
上記の器具に該当しない種目を勧める場合は、type を "custom" とし、details には { "name": "種目名", "value": "主なデータの文字列", "sets": セット数または null } を入れてください。
この JSON はアプリが自動解析するためのものです。本文で内容を繰り返し説明する必要はなく、Markdown のコードブロックで囲まずに、純粋な JSON 配列テキストとして出力してください。今回は必ず出力してください。`,
    'prompt.recoveryInstruction': `
【部位別の回復分析の出力形式 —— 今回のリクエストは構造化された回復データの出力を必要とするので、必ず出力してください】
アプリはトレーニング量と経過時間から、各部位の現在の回復度の推定値を算出済みです（100% = 完全回復）：
{algo}
この推定値を基準として分析してください。明確な根拠がある場合（筋肉痛のメモがある、特定部位が連日高強度、トレーニング量が異常など）に限り、個別の部位を ±15% 以内で補正し、それ以外の部位は推定値をそのまま使ってください。すべての回復度の数値は 5 の倍数にしてください。
非常に重要：出力は決定的でなければなりません。同じ入力データからは完全に同じ数値とコメントを出力し、ランダムな変動を持ち込まないでください。

人が読むための通常の回答が終わったあと、改行して、<!--GYMNOTE_RECOVERY_START--> と <!--GYMNOTE_RECOVERY_END--> で囲んだ JSON オブジェクトを追記してください。形式は次のとおりです：
{ "summary": "50字以内の全体的なアドバイス", "parts": [ { "part": "部位名", "recovery": 0-100の数値, "comment": "30字以内のその部位へのコメント" }, ... ] }
part は次の名称のいずれかにしてください（同じ部位は1回まで）：{parts}
この JSON はアプリが自動解析するためのものです。Markdown のコードブロックで囲まずに、純粋な JSON テキストとして、今回は必ず出力してください。`,
    'hist.titleWithMode': '{name}（{mode}）',
    'hist.massageDefault': 'マッサージ',
    'hist.strengthGroup': '{weight}kg × {reps}回 × {sets}セット',
    'hist.extraSuffix': ' (+セット外{n}回)',
    'hist.repsSets': '{reps}回 × {sets}セット',
    'hist.bikeVar': 'インターバル走 {time}分 | {summary}',
    'hist.bikePlain': '負荷 {resistance} | {time}分',
    'hist.tmVar': 'インターバル {time}分 | 傾斜 {incline}% | {distance}km | 約 {calories}kcal｜{summary}',
    'hist.tmPlain': '{time}分 | 速度 {speed}km/h | 傾斜 {incline}% | {distance}km | 約 {calories}kcal',
    'hist.massageStats': '{duration}分 | 強さ：{intensity}',
    'hist.customSets': ' × {sets}セット',
    'hist.varWarmup': 'ウォームアップ {speed}{unit}×{dur}分',
    'hist.varSeg': '{speed}{unit}×{dur}分',
    'hist.varSprint': 'スプリント {speed}{unit}×{dur}分',
    'hist.dateMd': '{m}月{d}日',
    'hist.dateToday': '今日 - {date}',
    'hist.dateYesterday': '昨日 - {date}',
    'hist.dateWithYear': '{y}年{date}',
    'empty.history': '該当する記録はまだありません。さっそく記録してみましょう！',
    'empty.bodyMetrics': '身体データがまだありません。「記録 → 身体データ」から登録してみましょう',
    'empty.part30': '直近30日の記録がまだありません',
    'empty.pr': '条件を満たす記録がまだありません。筋トレを2セット以上続けると記録されます',
    'metric.armShort': '腕',
    'metric.waistShort': '腹',
    'metric.chestShort': '胸',
    'trend.donutCenter': 'トレーニング',
    'trend.partCount': '{count}回 ({pct}%)',
    'trend.partTooltip': '{part}：{count}回 ({pct}%)',
    'trend.recoveryAiAt': 'AI分析 · {time}',
    'pr.newRecord': '{icon} 新記録！{label} {value}{unit}（これまでの {prev}{unit} を更新）',
    'pr.firstRecord': '{icon} 初記録！{label} {value}{unit}',
    'log.addGroupBtn': '＋ 別の重量セットを追加（同じ日の同じ種目は1件にまとめます）',
    'log.groupN': '重量セット {n}',
    'log.weightKg': '重量 (kg)',
    'log.weightHint': '—— 5kg 刻み',
    'log.extraRepsHintFull': '—— 任意。正規セット以外の追い込み・追加分',
    'log.segDuration': 'インターバル時間 (分)',
    'log.varToggle': 'インターバルモード（区間ごとに速度を設定）',
    'log.warmupSection': '🔥 ウォームアップ',
    'log.sectionHintZero': '（速度・時間とも 0 のままで可）',
    'log.varSection': '⚡ インターバル区間',
    'log.varSectionHint': '（区間ごとに速度と時間を指定）',
    'log.addSegment': '＋ インターバル区間を追加',
    'log.sprintSection': '🚀 スプリント',
    'log.totalTimeHint': '—— 空欄なら各区間の合計',
    'log.exerciseMode': '種目タイプ',
    'log.tmWalk': '🚶 早歩き',
    'log.tmRun': '🏃 ランニング',
    'log.speedKmh': '速度 (km/h)',
    'log.resistance': '負荷レベル (1-24)',
    'log.bikeTime': '走行時間 (分)',
    'log.massageMode': 'マッサージモード',
    'log.massageDuration': 'マッサージ時間',
    'log.massageIntensity': '強さ',
    'log.customName': '種目名',
    'log.customValue': '主なデータ（重量・回数など）',
    'log.customSets': 'セット数（任意）',
    'log.bmWeightHint': '—— 小数第1位まで',

    // ---- 历史 ----
    'hist.title': 'トレーニング履歴',
    'hist.sub': '流した汗のすべてを振り返る',
    'hist.filterAll': 'すべての種目',
    'hist.custom': 'カスタム種目',
    'hist.workout': 'トレーニング',
    'hist.variable': 'インターバル',
    'hist.walk': '早歩き',
    'hist.jog': 'ジョギング',
    'hist.editRecord': '記録を編集',
    'hist.deleteRecord': '記録を削除',
    'hist.intensityLow': '弱',
    'hist.intensityMid': '中',
    'hist.intensityHigh': '強',

    // ---- 趋势 / 推移 ----
    'trend.title': 'トレーニングの推移',
    'trend.sub': 'カレンダー / 部位別の分布 / 自己ベスト',
    'trend.calTitle': 'トレーニングカレンダー',
    'trend.calSub': '直近1年のヒートマップ',
    'trend.calLess': '少',
    'trend.calMore': '多',
    'trend.calTooltip': '{date}：{count}種目',
    'trend.bodyTitle': '身体データ',
    'trend.bodySub': '体重 / 腕囲 / 腹囲 / 胸囲',
    'trend.recoveryTitle': '疲労回復度',
    'trend.recoverySourceAlgo': 'トレーニング量と経過時間から自動推定',
    'trend.recoverySourceAi': 'AIの身体分析の結果を反映',
    'trend.clearAi': 'AI分析を消去して自動推定に戻す',
    'trend.partTitle': '部位別の統計',
    'trend.partSub': '直近30日のトレーニング分布',
    'trend.partAria': '直近30日の部位別トレーニング分布',
    'trend.prTitle': '自己ベスト (PR)',
    'trend.prSub': '筋トレは2セット以上連続で達成した場合のみ記録',

    'rec.recovered': '回復済み',
    'rec.recovering': '回復中',
    'rec.fatigued': '疲労',

    // ---- AI コーチ ----
    'ai.title': 'AIフィットネスコーチ',
    'ai.sub': '記録データを踏まえて、AIコーチがあなた向けの提案をします',
    'ai.modeChat': 'チャット',
    'ai.modeChatDesc': '自由に質問・相談。AIが記録の履歴を踏まえて答えます',
    'ai.modeMenu': 'トレーニングメニュー',
    'ai.modeMenuDesc': '対話でメニューを作成。ホーム画面からワンタップで記録できます',
    'ai.modeAnalysis': '身体分析',
    'ai.modeAnalysisDesc': '部位ごとのトレーニング量と回復状況を分析し、推移タブに反映します',
    'ai.backToModes': 'モード選択に戻る',
    'ai.history': '会話履歴',
    'ai.newChat': '新しい会話',
    'ai.newSession': '新しい会話',
    'ai.inputPlaceholder': '聞きたいことを入力',
    'ai.inputPlaceholderChat': '聞きたいことを入力（例：「最近のレッグプレスの重量は伸びている？」）',
    'ai.inputPlaceholderMenu': 'ご要望を入力（例：「今日は脚と体幹を40分だけ」）',
    'ai.inputPlaceholderAnalysis': 'そのまま質問もできます（例：「今週のバランスは？明日は何を鍛えるべき？」）',
    'ai.quickAction': 'クイック操作',
    'ai.quickActionChat': 'トレーニングデータをまとめる',
    'ai.quickActionMenu': '今日のメニューを生成',
    'ai.quickActionAnalysis': '回復状況を分析',
    'ai.send': '送信',
    'ai.you': 'あなた',
    'ai.coachClaude': 'Claude コーチ',
    'ai.coachGemini': 'Gemini コーチ',
    'ai.coachOpenai': 'ChatGPT コーチ',
    'ai.loadingMenu': 'メニューを作成しています。少々お待ちください...',
    'ai.loadingAnalysis': 'トレーニングの分布と回復状況を分析しています。少々お待ちください...',
    'ai.loadingThinking': '考えています。少々お待ちください...',
    'ai.recommendTitle': 'トレーニングのおすすめ',
    'ai.recFrom': '{provider} のおすすめ',
    'ai.recComplete': '完了して記録',
    'ai.recAdjust': '強度・セット数を調整してから完了',
    'ai.recReject': 'このおすすめは不要',
    'ai.warmup': 'ウォームアップ',
    'ai.sprint': 'スプリント',
    'ai.promptDialogTitle': '生成完了！あなた専用のプロンプトです',
    'ai.promptDialogDesc': 'そのままコピーして、大規模言語モデル（Gemini や ChatGPT など）に貼り付けて相談できます：',
    'ai.copyPrompt': 'プロンプトをコピー',

    // ---- 设置 ----
    'set.title': '設定',
    'set.sub': 'カスタマイズとデータ管理',
    'set.profileTitle': '👤 身体プロフィール',
    'set.weightLabel': '体重 (kg)',
    'set.weightHint': '—— 小数第1位まで。ランニングマシンなどの消費カロリー推定に使用します',
    'set.aiTitle': '🤖 AIコーチの設定',
    'set.aiDesc': 'Anthropic Claude、Google Gemini、<strong>ChatGPT（OpenAI）</strong>に対応。API キーはこのブラウザ内にのみ保存され、どのサーバーにも送信されません。ChatGPT のサブスクリプションと OpenAI API の利用料は別会計です。',
    'set.providerLabel': 'AI プロバイダー',
    'set.providerClaude': 'Claude (Anthropic・推奨)',
    'set.providerGemini': 'Gemini (Google)',
    'set.providerOpenai': 'ChatGPT (OpenAI)',
    'set.modelLabel': 'モデルの選択',
    'set.apiKeyLabel': '{provider} API Key',
    'set.hintClaude': '<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic コンソール</a>で Claude の API キーを取得してください。',
    'set.hintGemini': '<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>で Gemini の API キーを無料で取得できます。',
    'set.hintOpenai': '<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI Platform</a>で API キーを作成してください。「Share inputs and outputs with OpenAI」を有効にし、アカウント残高がプラスであれば、以下のモデルの共有トラフィックは自動的に無料枠として計上されます。ChatGPT のサブスクリプションと API の利用量は別会計です。',
    'set.syncTitle': '☁️ GitHub による自動クラウド同期',
    'set.syncDesc': 'お持ちの GitHub アカウントを無料のクラウドデータベースとして利用します。設定すると、スマートフォンと PC のデータが保存時・読み込み時に自動でプライベートに同期されます。',
    'set.tokenLabel': 'GitHub Personal Access Token (PAT)',
    'set.tokenHint': '—— gist 権限のみ必要です',
    'set.gistLabel': 'Gist ID',
    'set.gistHint': '—— 自動で生成・紐づけされます',
    'set.gistPlaceholder': 'トークンを保存して同期すると自動で紐づきます。他の Gist ID を貼り付けることもできます',
    'set.syncBtn': '今すぐ同期',
    'set.backupTitle': '💾 データの書き出しと読み込み',
    'set.backupDesc': 'ブラウザのキャッシュ削除による記録の消失を防ぐため、定期的なバックアップをおすすめします。',
    'set.export': 'バックアップを書き出す (JSON)',
    'set.import': 'バックアップを読み込む (JSON)',
    'set.dangerTitle': '⚠️ 取り扱い注意',
    'set.dangerDesc': 'ローカルに保存されたトレーニング記録をすべて削除します。この操作は取り消せません。',
    'set.resetBtn': 'すべてのデータを削除',

    'model.claudeOpus': 'Claude Opus 4.8（最高性能・推奨）',
    'model.claudeSonnet': 'Claude Sonnet 5（速度と品質のバランス）',
    'model.claudeHaiku': 'Claude Haiku 4.5（最も低コスト・高速）',
    'model.geminiFlash': 'Gemini 3.7 Flash（最新・推奨）',
    'model.geminiPro': 'Gemini 3.1 Pro（推論性能が高い・プレビュー版）',
    'model.geminiLite': 'Gemini 3.1 Flash-Lite（最も低コスト・高速）',
    'model.gptTerra': 'GPT-5.6 Terra（既定：日常のコーチング / 無料 250万）',
    'model.gptSol': 'GPT-5.6 Sol（本格的な振り返り / 無料 25万）',
    'model.gptLuna': 'GPT-5.6 Luna（軽量で高速な Q&A / 無料 250万）',

    // ---- 云同步状态 ----
    'sync.statusLinked': 'クラウドに接続済み',
    'sync.statusToken': 'トークン設定済み・初回同期待ち',
    'sync.statusNone': '同期は未設定',
    'sync.needToken': 'まず設定画面で GitHub Personal Access Token (PAT) を登録してください。',
    'sync.syncing': '同期中...',
    'sync.connecting': 'GitHub に接続しています...',
    'sync.searching': 'クラウド上の既存データを検索しています...',
    'sync.found': '既存のクラウドデータが見つかりました。紐づけています...',
    'sync.searchFailed': '検索に失敗しました。新規作成を試みます: ',
    'sync.creating': '新しいプライベートストレージを作成しています...',
    'sync.created': 'プライベートストレージの作成と紐づけが完了しました！',
    'sync.pulling': 'クラウドの記録を取得しています...',
    'sync.gistDeleted': '紐づけていたクラウドストレージが削除されていたため、リセットしました。もう一度同期を押して作り直してください。',
    'sync.merging': '2つの端末の記録を統合しています...',
    'sync.uploading': 'バックアップをアップロードしています...',
    'sync.clearingCloud': '⌛ クラウドのデータを削除しています...',

    // ---- 提示与错误 ----
    'msg.needValidGroup': '有効な回数とセット数を1組以上入力してください。',
    'msg.needCustomName': 'カスタム種目の名前を入力してください。',
    'msg.editSaved': '✅ 変更を保存しました！',
    'msg.logged': '🎉 記録しました！',
    'msg.needBodyMetric': '身体データを1つ以上入力してください。',
    'msg.bodyUpdated': '✅ 身体データを更新しました！',
    'msg.bodyRecorded': '📏 身体データを記録しました！',
    'msg.confirmDeleteMetric': 'この身体データを削除しますか？',
    'msg.confirmDeleteWorkout': 'この記録を削除しますか？この操作は取り消せません。',
    'msg.confirmDeleteChat': 'この会話履歴を削除しますか？この操作は取り消せません。',
    'msg.needValidGroupRec': '有効な重量セットを1つ以上残してください（回数とセット数はどちらも 0 より大きい必要があります）。',
    'msg.needValidSegments': '有効なインターバル区間と合計時間を入力してください。',
    'msg.copySuccess': 'コピーしました！Gemini や ChatGPT のウェブ版にそのまま貼り付けられます。',
    'msg.copySuccessFallback': 'コピーしました！（フォールバック経由）',
    'msg.importSuccess': '🎉 データを統合して読み込みました！PC とスマートフォンのデータが統合されています。',
    'msg.importInvalid': '読み込みに失敗しました：GymNote のバックアップ JSON ファイルではありません。',
    'msg.importParseError': '読み込みに失敗しました：ファイルを解析できません。',
    'msg.confirmReset1': '🚨 警告：ローカルに保存されたトレーニング記録がすべて削除されます。続行しますか？',
    'msg.confirmReset2': 'もう一度確認します：本当に完全に削除しますか？（API キーと体重の設定は残し、ローカルとクラウドの記録のみ削除します）',
    'msg.syncSuccess': '🎉 クラウド同期が完了しました！記録は失われることなく統合されています。',
    'err.cloudUpdate': 'クラウドデータの更新に失敗しました',
    'err.clearCloud': '⚠️ GitHub 上のデータ削除に失敗したため、ローカルのみ削除します。エラー: ',
    'err.claude': 'Claude へのリクエストに失敗しました。API キーが有効か確認してください。',
    'err.claudeSafety': 'Claude が安全ポリシーによりこのリクエストを拒否しました。表現を変えてお試しください。',
    'err.openai': 'OpenAI へのリクエストに失敗しました。API キーとアカウント残高を確認してください。',
    'err.openaiEmpty': 'OpenAI から表示できるテキストが返されませんでした。',
    'err.gemini': 'Gemini へのリクエストに失敗しました。API キーが有効か確認してください。',

    // ---- 项目名 ----
    'type.leg_press': 'レッグプレス',
    'type.shoulder_press': 'ショルダープレス',
    'type.chest_press': 'チェストプレス',
    'type.preacher_curl': 'プリーチャーカール',
    'type.lat_pulldown': 'ラットプルダウン',
    'type.situps': '腹筋（シットアップ）',
    'type.spin_bike': 'エアロバイク',
    'type.treadmill': 'ランニングマシン',
    'type.massage_chair': 'マッサージチェア',
    'type.body_metrics': '身体データ',
    'type.custom': 'カスタム',

    // ---- 分类 ----
    'cat.strength': '筋トレ',
    'cat.core': '体幹',
    'cat.cardio': '有酸素',
    'cat.relax': 'リカバリー',
    'cat.body': '身体データ',
    'cat.other': 'その他',
    'cat.strengthFull': '筋力トレーニング',
    'cat.coreFull': '腹筋・体幹',
    'cat.cardioFull': '有酸素・脂肪燃焼',
    'cat.relaxFull': 'ストレッチ・リカバリー',
    'cat.bodyFull': '身体データ (Body Metrics)',
    'cat.customFull': 'カスタム種目 (Custom)',

    // ---- 身体部位 ----
    'part.legs': '脚',
    'part.chest': '胸',
    'part.back': '背中',
    'part.shoulder': '肩',
    'part.core': '体幹',
    'part.arm': '腕',
    'part.cardio': '有酸素',
    'part.recovery': 'リカバリー',
    'part.other': 'その他',

    // ---- 体测项目 ----
    'metric.weight': '体重',
    'metric.arm': '腕囲',
    'metric.waist': '腹囲',
    'metric.chest': '胸囲',

    // ---- 按摩椅模式 / 时长预设 ----
    'mode.auto': 'オートリラックス',
    'mode.neck': '首・肩重点',
    'mode.stretch': '全身ストレッチ',
    'mode.hip': '腰・臀部リラックス',
    'dur.m15': '15 分',
    'dur.m30': '30 分',
    'dur.m45': '45 分',
    'dur.h1': '1 時間',
    'dur.h1m15': '1 時間 15 分',
    'dur.h1m30': '1 時間 30 分',
    'dur.h1m45': '1 時間 45 分',
    'dur.h2': '2 時間',

    // ---- 单位与星期 ----
    'unit.min': '分',
    'unit.gear': '段',
    'unit.times': '回',
    'wd.sun': '日', 'wd.mon': '月', 'wd.tue': '火', 'wd.wed': '水',
    'wd.thu': '木', 'wd.fri': '金', 'wd.sat': '土',
    'week.3ago': '3週前', 'week.2ago': '2週前', 'week.last': '先週', 'week.this': '今週',

    // ---- 器械说明（供 AI 参考）----
    'equip.legPressNote': '筋力トレーニング、下半身',
    'equip.shoulderPressNote': '筋力トレーニング、肩',
    'equip.chestPressNote': '筋力トレーニング、胸',
    'equip.preacherCurlNote': '筋力トレーニング、上腕二頭筋',
    'equip.latPulldownNote': '筋力トレーニング、背中',
    'equip.situpsNote': '体幹トレーニング',
    'equip.spinBikeNote': '有酸素トレーニング',
    'equip.treadmillNote': '有酸素トレーニング',
    'equip.massageChairNote': 'ストレッチ・リカバリー（筋トレ／有酸素ではない）',

    // ---- 首次运行的示例数据 ----
    'mock.note1': 'ウォームアップの早歩き',
    'mock.note2': 'レッグプレス 2台目のマシン',
    'mock.note3': '右肩が少し重い',
    'mock.note4': '負荷がやや軽い',
    'mock.note5': 'チェストプレス、調子は good',
    'mock.note6': '全身の筋肉痛をほぐす',
    'mock.note7': '重量を上げた。ふくらはぎが少し張る',
    'mock.note8': '腹筋・体幹の日',
    'mock.note9': '今日はよく走れた。汗だく'
  },

  // ---------------- 简体中文 ----------------
  zh: {
    'app.title': 'GymNote 智能健身助手',
    'app.badge': '个人版',
    'app.themeToggle': '切换日间/夜间模式',
    'app.langToggle': '切换语言（日本語 / 中文）',

    'nav.home': '主页',
    'nav.log': '打卡',
    'nav.history': '历史',
    'nav.trends': '趋势',
    'nav.ai': 'AI教练',
    'nav.settings': '设置',

    'common.cancel': '取消',
    'common.close': '关闭',
    'common.edit': '编辑',
    'common.delete': '删除',
    'common.remove': '移除',
    'common.today': '今天',
    'common.optional': '选填',
    'common.optionalSuffix': '—— 可选',
    'common.settings': '设置',

    'dash.hello': '你好，健身达人 👋',
    'dash.helloSub': '今天也是充满活力的一天，开始打卡吧！',
    'dash.cta': '立即打卡',
    'dash.weeklyTitle': '本周运动频次',
    'dash.weeklySub': '近7天活动',
    'dash.trendTitle': '训练趋势分析',
    'dash.trendSub': '近30天占比 / 近4周趋势',
    'dash.legendStrength': '力量+核心 {count}次 ({pct}%)',
    'dash.legendCardio': '有氧 {count}次 ({pct}%)',
    'dash.legendOther': '其他 {count}次 ({pct}%)',
    'dash.miniVolume': '力量容量趋势 (kg)',
    'dash.miniCardio': '有氧时长趋势 (分钟)',
    'dash.aiRecTitle': 'AI 教练推荐',
    'dash.aiRecSub': '来自 AI 教练的训练建议',
    'dash.quickStart': '快捷开始',

    'dialog.adjustTitle': '调整推荐',
    'dialog.saveAdjust': '保存调整',

    'log.newTitle': '新增健身打卡',
    'log.newSub': '选择你要记录的运动项目',
    'log.back': '返回项目',
    'log.exercise': '运动项目',
    'log.dateLabel': '打卡日期',
    'log.dateHint': '—— 默认今天，也可以选过去的日期补记',
    'log.notesLabel': '运动备注 / 心得',
    'log.notesPlaceholder': "添加备注，如 '今天感觉轻松' 或者是器材编号",
    'log.save': '保存本次打卡',
    'log.saveEdit': '保存修改',
    'log.weightGroup': '重量组',
    'log.weightGroupN': '重量组 {n}',
    'log.repsPerSet': '每组次数',
    'log.sets': '组数',
    'log.extraReps': '组外次数',
    'log.speed': '速度',
    'log.duration': '时长 (分钟)',
    'log.incline': '坡度 (%)',
    'log.totalTime': '总时长 (分钟)',
    'log.segmentsTitle': '变速段',
    'log.segmentLabel': '变速 {n} · 速度 ({unit})',
    'log.segmentSum': '各段之和',
    'log.estDistance': '预计距离',
    'log.estCalories': '预计消耗',
    'log.customNamePlaceholder': '请输入运动名称 (例如: 哑铃飞鸟)',
    'log.customValuePlaceholder': '例如: 15kg / 12次',
    'log.customSetsPlaceholder': '例如: 3',
    'sync.errCreateGist': '创建 Gist 失败: {status} (错误码: {code})',
    'sync.errFetch': '获取云端数据失败: {status}',
    'sync.errUpload': '上传云端备份失败: {status}',
    'sync.successStatus': '同步成功 (合并后共 {n} 条记录，于 {time})',
    'sync.failedStatus': '同步失败: {msg}',
    'sync.failedAlert': '❌ 云同步失败：{msg}',
    'ai.historyEmpty': '暂无历史对话，发送第一条消息后会自动生成～',
    'ai.needKeyMenu': '生成训练菜单需要先在"设置"页配置 {keyLabel}（免 Key 的"打包健身数据"模式无法自动生成推荐列表，只能手动复制文字）。',
    'ai.needKeyAnalysis': '身体分析需要先在"设置"页配置 {keyLabel}。',
    'ai.askMenu': '请根据我的可用器械，安排一份今天可以完成的具体训练菜单，包含项目、重量、组数等可执行的强度安排。',
    'ai.askAnalysis': '请基于我的打卡数据，分析各身体部位的训练量分布和当前的疲劳恢复状况，并把结构化结果推送给 App。',
    'ai.planPushed': '\n\n✅ 已为你生成 {n} 条训练推荐，可以在首页「AI 教练推荐」模块查看，点击完成会自动生成今天的打卡记录。',
    'ai.recoveryPushed': '\n\n✅ 分析结果已推送到「趋势」板块的恢复进度模块。',
    'ai.errorPrefix': '❌ 发生错误：{msg}',
    'rec.dialogTitle': '调整推荐：{label}',
    'rec.massageDurationMin': '按摩时长 (分钟)',
    'rec.massageIntensityHint': '强度级别 (1弱 / 2中 / 3强)',
    'rec.itemName': '项目名称',
    'rec.intensityBikeVar': '变速骑行 {time}分钟：{summary}',
    'rec.intensityBike': '阻力{resistance}档，骑行{time}分钟',
    'rec.intensityTmVar': '变速跑 {time}分钟，坡度{incline}%：{summary}',
    'rec.intensityTm': '{mode} {time}分钟，速度{speed}km/h，坡度{incline}%',
    'rec.intensityMassage': '{mode}，{duration}分钟，强度{intensity}',
    'rec.varHelp': '每个变速段都可独立调整；总时长应等于各段时长之和。',
    'rec.sectionHintZero': '（可填 0）',
    'rec.addSegment': '＋ 添加变速段',
    'rec.groupFmt': '{weight}kg × {reps}次 × {sets}组{extra}',
    'rec.extraSuffix': ' + 组外{n}次',
    'rec.segFmt': '{speed}{unit} × {dur}分',
    'rec.segN': '变速 {n}',
    'rec.varSummary': '变速训练 · {meta}',
    'rec.metaTime': '{time}分钟',
    'rec.metaIncline': ' · 坡度{incline}%',
    'rec.btnDone': '✓ 完成',
    'rec.btnAdjust': '✎ 调整',
    'rec.btnReject': '✕ 拒绝',
    'rec.adjustHelp': '每个重量组都可在完成前独立调整；保存后会原样带入打卡记录。',
    'rec.addGroup': '＋ 添加重量组',
    'rec.weightHint': '—— 以 5kg 为单位调整',
    'prompt.langDirective': '请务必使用{lang}回答。',
    'prompt.bodyLine': '- 最近体测 ({date}): {parts}\n',
    'prompt.bodyArm': '臂围 {v}cm',
    'prompt.bodyWaist': '腰围 {v}cm',
    'prompt.bodyChest': '胸围 {v}cm',
    'prompt.scopeToday': '仅限今天（{date}）的训练记录。不要把之前日期的打卡混进「今天的训练分析」；若今天没有记录，要直接说明。',
    'prompt.scopeRecent': '最近 30 条训练记录（最新排在最前）。',
    'prompt.noRecords': '（尚无记录。我刚刚开始健身，请指导我如何入门并分配力量与有氧运动）\n',
    'prompt.dtMassage': '模式 [{mode}]，放松 {duration}分钟，力度级别 {intensity}',
    'prompt.dtCustom': '[{name}] - 数据: {value}{sets}',
    'prompt.dtCustomSets': ' x {sets}组',
    'prompt.recordLine': '{i}. 日期: {date} | 项目: {type} | 运动详情: {details} {notes}\n',
    'prompt.notesPart': '| 个人备注: "{notes}"',
    'prompt.tailToday': '\n请只依据「今天」的记录回答本轮提问。先给今天训练的结论，再说是否适合补练、休息或做轻有氧；不要复述、更不要比较之前日期的记录。',
    'prompt.tailRecent': '\n请结合近期记录回答本轮提问；需要比较趋势时，明确指出使用了哪些日期的数据。',
    'prompt.tailCommon': '\n回答要直接、具体、不过度承诺；涉及疼痛、受伤或明显不适时，建议停止加练并咨询专业人士。',
    'ai.noKeyGuide': `未检测到您的 {keyLabel}。

我已经将您的最近健身打卡数据与刚才的提问打包。请切换到「聊天」模式点击“**打包健身数据**”按钮直接复制，在任意 AI 网页端提问即可！
当然，如果您希望在应用内获得直连的丝滑对话，可以在“设置”页面中输入您的 {keyLabel}。`,
    'ai.welcomeChat': `你好！我是你的 AI 健身教练。这里是**自由聊天模式**，你可以随便问我训练、饮食、恢复相关的问题，我会结合你的打卡历史来回答。

**💡 提示：**
1. 需要 AI 定制可一键打卡的训练菜单？返回上一级选择「训练菜单」模式
2. 想了解各部位的疲劳与恢复状况？选择「身体分析」模式
3. 没有配置 API Key 也可以点击下方「打包健身数据」，复制 Prompt 粘贴到任意 AI 网页端使用`,
    'ai.welcomeMenu': `这里是**训练菜单模式**。直接告诉我你今天的目标、状态或时间限制，我会给出一份具体可执行的训练菜单，并自动推送到主页的「AI 教练推荐」模块，可以一键打卡。

也可以点击下方「一键生成今日菜单」，我会根据你的训练历史和恢复状况直接安排。

注意：新生成的菜单会替换掉主页上还没处理完的旧推荐。`,
    'ai.welcomeAnalysis': `这里是**身体分析模式**。我会基于你近期的打卡数据，分析各身体部位的训练量分布与疲劳恢复状况。

点击下方「一键分析恢复状况」，分析结果会自动推送到「趋势」板块的恢复进度模块（覆盖算法估算值，并附上我的点评）。`,
    'prompt.summaryMain': `你是一位专业且充满亲和力的个人健身教练。请为我分析最近的运动成果并提供针对性建议。
{langDirective}

【重要限制：当前可用器械清单】
{equipment}

请严格注意：你所有的训练建议、动作推荐，必须只从上面这份器材清单里选择。不要提及或推荐清单之外的动作和器材；如某个目标在清单里没有直接对应的器材，请从清单中挑选功能最相近的替代动作，并说明这是替代方案。

另外请注意：力量训练器械的配重以 5kg 为最小单位调整，不支持 2.5kg 这种半档，所以给出的所有重量建议必须是 5 的整数倍（如 20kg、25kg、30kg），不要出现 2.5kg 的倍数。

重要：本 App 的力量打卡支持"同一天同项目多重量组"，一条记录可以包含多个不同重量的组（例如高位下拉 25kg×12×3 组，再加 30kg×8×2 组）。请在给出训练菜单时，充分利用这种多重量组结构（比如金字塔递增/递减、递减组）。有氧（跑步机/单车）支持"变速"模式，可分为热身段、若干变速段（不同速度各自间隔时长）、冲刺段，请在需要时给出分段配速建议。

【我的个人档案】
- 体重: {weight} kg
{bodyMetrics}
【本次分析的数据范围】
{scope}

【训练打卡记录】
`,
    'prompt.planInstruction': `
【结构化训练计划输出格式 —— 本次请求就是在向你要一份具体可执行的训练菜单，必须输出】
请在你正常的、给人看的回复内容结束之后，另起一行，追加一个由 <!--GYMNOTE_PLAN_START--> 和 <!--GYMNOTE_PLAN_END--> 包裹的 JSON 数组，
数组每一项代表一个推荐动作，格式为：
{ "type": "器材英文标识", "label": "展示名称", "intensity": "给人看的强度描述文字", "details": { ...结构化数值字段 } }
type 必须是以下英文标识之一，details 字段必须严格匹配对应 schema：
  - 力量项目 "leg_press" / "shoulder_press" / "chest_press" / "preacher_curl" / "lat_pulldown"：
      details = { "groups": [ { "weight": 数字(必须为5的整数倍), "reps": 数字, "sets": 数字, "extraReps": 数字或0 }, ... ] }
      （groups 数组支持"多重量组"——如需金字塔/递减组，就放多组不同 weight；只做一组也要用 groups 包一个元素）
  - "situps"：details = { "reps": 数字, "sets": 数字, "extraReps": 数字或0 }
  - "spin_bike"：details = { "resistance": 数字1-24, "time": 分钟数 }
  - "treadmill"：details = { "mode": "walk" 或 "run", "speed": km/h数字, "incline": 坡度数字, "time": 分钟数 }
  - "massage_chair"：details = { "mode": 字符串, "duration": 分钟数, "intensity": 1/2/3 }
如果推荐的动作不在上述器材范围内，type 请填 "custom"，details 填 { "name": "动作名称", "value": "关键数据文字", "sets": 组数或null }。
这段 JSON 是给 App 自动解析用的，不需要在正文里重复解释它，也不要用 Markdown 代码块包裹，直接是纯 JSON 数组文本，且这次务必要输出。`,
    'prompt.recoveryInstruction': `
【身体部位恢复分析输出格式 —— 本次请求需要输出结构化的恢复分析数据，必须输出】
App 已按训练量和间隔时间算出了各部位当前的恢复度估算值（100% = 完全恢复）：
{algo}
请以这些估算值为基准进行分析。你只在有明确依据时（比如用户备注了酸痛、某部位连续多日高强度训练、训练量异常）
对个别部位做 ±15% 以内的修正，其余部位直接沿用估算值。所有恢复度数值必须是 5 的整数倍。
非常重要：你的输出必须是确定性的——同样的输入数据必须给出完全相同的数值和点评，不要引入任何随机变化。

请在你正常的、给人看的回复内容结束之后，另起一行，追加一个由 <!--GYMNOTE_RECOVERY_START--> 和 <!--GYMNOTE_RECOVERY_END--> 包裹的 JSON 对象，格式为：
{ "summary": "不超过50字的总体训练建议", "parts": [ { "part": "部位名", "recovery": 数值0-100, "comment": "不超过30字的该部位点评" }, ... ] }
part 必须是以下名称之一（每个部位最多出现一次）：{parts}
这段 JSON 是给 App 自动解析用的，不要用 Markdown 代码块包裹，直接是纯 JSON 文本，且这次务必要输出。`,
    'hist.titleWithMode': '{name} ({mode})',
    'hist.massageDefault': '按摩',
    'hist.strengthGroup': '{weight}kg × {reps}次 × {sets}组',
    'hist.extraSuffix': ' (+组外{n}次)',
    'hist.repsSets': '{reps}次 × {sets}组',
    'hist.bikeVar': '变速骑行 {time}分钟 | {summary}',
    'hist.bikePlain': '阻力 {resistance}档 | 骑行 {time}分钟',
    'hist.tmVar': '变速 {time}分钟 | 坡度 {incline}% | {distance}km | 约 {calories}kcal｜{summary}',
    'hist.tmPlain': '{time}分钟 | 速度 {speed}km/h | 坡度 {incline}% | {distance}km | 约 {calories}kcal',
    'hist.massageStats': '时长 {duration}分钟 | 力度：{intensity}',
    'hist.customSets': ' × {sets}组',
    'hist.varWarmup': '热身 {speed}{unit}×{dur}分',
    'hist.varSeg': '{speed}{unit}×{dur}分',
    'hist.varSprint': '冲刺 {speed}{unit}×{dur}分',
    'hist.dateMd': '{m}月{d}日',
    'hist.dateToday': '今天 - {date}',
    'hist.dateYesterday': '昨天 - {date}',
    'hist.dateWithYear': '{y}年{date}',
    'empty.history': '暂无相关健身记录，快去打卡吧！',
    'empty.bodyMetrics': '还没有身体数据，去「打卡 → 身体数据」记录一次吧',
    'empty.part30': '最近30天还没有打卡记录',
    'empty.pr': '还没有达标的 PR 记录，力量项目练到连续2组以上就会被记录哦',
    'metric.armShort': '臂',
    'metric.waistShort': '腰',
    'metric.chestShort': '胸',
    'trend.donutCenter': '次训练',
    'trend.partCount': '{count}次 ({pct}%)',
    'trend.partTooltip': '{part}：{count}次 ({pct}%)',
    'trend.recoveryAiAt': 'AI 分析 · {time}',
    'pr.newRecord': '{icon} 新纪录！{label} {value}{unit}（超越 {prev}{unit}）',
    'pr.firstRecord': '{icon} 首个纪录！{label} {value}{unit}',
    'log.addGroupBtn': '＋ 添加其他重量组（同一天同项目合并为一条记录）',
    'log.groupN': '第 {n} 组重量',
    'log.weightKg': '重量 (kg)',
    'log.weightHint': '—— 以 5kg 为最小档位',
    'log.extraRepsHintFull': '—— 可选，正式组数之外力竭/额外加练',
    'log.segDuration': '间隔时长 (分钟)',
    'log.varToggle': '变速模式（分段配速）',
    'log.warmupSection': '🔥 热身段',
    'log.sectionHintZero': '（速度与时长可留 0）',
    'log.varSection': '⚡ 变速段',
    'log.varSectionHint': '（不同速度与各自间隔时长）',
    'log.addSegment': '＋ 添加一个变速段',
    'log.sprintSection': '🚀 冲刺段',
    'log.totalTimeHint': '—— 留空则按各段之和',
    'log.exerciseMode': '运动类型',
    'log.tmWalk': '🚶 快走',
    'log.tmRun': '🏃 跑步',
    'log.speedKmh': '速度 (km/h)',
    'log.resistance': '阻力档位 (1-24)',
    'log.bikeTime': '骑行时长 (分钟)',
    'log.massageMode': '按摩模式',
    'log.massageDuration': '按摩时长',
    'log.massageIntensity': '强度级别',
    'log.customName': '运动项目名称',
    'log.customValue': '关键数据 (如重量/次数)',
    'log.customSets': '组数 (非必填)',
    'log.bmWeightHint': '—— 精确到小数点后一位',

    'hist.title': '健身历程',
    'hist.sub': '回顾你流下的每一滴汗水',
    'hist.filterAll': '所有项目',
    'hist.custom': '自定义项目',
    'hist.workout': '健身运动',
    'hist.variable': '变速',
    'hist.walk': '快走',
    'hist.jog': '慢跑',
    'hist.editRecord': '编辑记录',
    'hist.deleteRecord': '删除记录',
    'hist.intensityLow': '弱',
    'hist.intensityMid': '中',
    'hist.intensityHigh': '强',

    'trend.title': '训练趋势',
    'trend.sub': '打卡日历 / 身体部位分布 / 个人最佳纪录',
    'trend.calTitle': '打卡日历',
    'trend.calSub': '近1年打卡热力图',
    'trend.calLess': '少',
    'trend.calMore': '多',
    'trend.calTooltip': '{date}：{count}项运动',
    'trend.bodyTitle': '身体数据',
    'trend.bodySub': '体重 / 臂围 / 腰围 / 胸围',
    'trend.recoveryTitle': '恢复进度',
    'trend.recoverySourceAlgo': '按训练量与间隔实时估算',
    'trend.recoverySourceAi': '已采用 AI 身体分析结果',
    'trend.clearAi': '清除AI分析，恢复算法估算',
    'trend.partTitle': '身体部位统计',
    'trend.partSub': '近30天训练分布',
    'trend.partAria': '近30天身体部位训练分布',
    'trend.prTitle': '个人最佳纪录 (PR)',
    'trend.prSub': '力量项目需连续完成2组以上才计入',

    'rec.recovered': '已恢复',
    'rec.recovering': '恢复中',
    'rec.fatigued': '疲劳',

    'ai.title': 'AI 智能健身顾问',
    'ai.sub': '结合你的打卡数据，让 AI 教练给你针对性的健身建议',
    'ai.modeChat': '聊天',
    'ai.modeChatDesc': '自由提问、闲聊、答疑，AI 会结合你的打卡历史给建议',
    'ai.modeMenu': '训练菜单',
    'ai.modeMenuDesc': '对话式定制训练菜单，生成后推送到主页一键打卡',
    'ai.modeAnalysis': '身体分析',
    'ai.modeAnalysisDesc': '分析各部位训练量与恢复状况，结果推送到趋势板块',
    'ai.backToModes': '返回模式选择',
    'ai.history': '历史对话',
    'ai.newChat': '新对话',
    'ai.newSession': '新对话',
    'ai.inputPlaceholder': '输入你想问的问题',
    'ai.inputPlaceholderChat': "输入你想问的问题，如：'分析我最近的腿举重量是否有进步？'",
    'ai.inputPlaceholderMenu': "描述你的需求，如：'今天想练腿和核心，时间只有40分钟'",
    'ai.inputPlaceholderAnalysis': "可以直接提问，如：'我这周练得均衡吗？明天适合练什么？'",
    'ai.quickAction': '快捷操作',
    'ai.quickActionChat': '打包健身数据',
    'ai.quickActionMenu': '一键生成今日菜单',
    'ai.quickActionAnalysis': '一键分析恢复状况',
    'ai.send': '发送',
    'ai.you': '你',
    'ai.coachClaude': 'Claude 教练',
    'ai.coachGemini': 'Gemini 教练',
    'ai.coachOpenai': 'ChatGPT 教练',
    'ai.loadingMenu': '正在为你安排训练菜单，请稍候...',
    'ai.loadingAnalysis': '正在分析你的训练分布与恢复状况，请稍候...',
    'ai.loadingThinking': '正在思考中，请稍候...',
    'ai.recommendTitle': '训练推荐',
    'ai.recFrom': '来自 {provider} 推荐',
    'ai.recComplete': '完成并打卡',
    'ai.recAdjust': '调整强度/组数后再完成',
    'ai.recReject': '不需要这条推荐',
    'ai.warmup': '热身',
    'ai.sprint': '冲刺',
    'ai.promptDialogTitle': '打包成功！专属健身 Prompt 已生成',
    'ai.promptDialogDesc': '你可以直接点击复制，粘贴给大语言模型（如 Gemini、ChatGPT等）进行深度咨询：',
    'ai.copyPrompt': '复制 Prompt 内容',

    'set.title': '系统设置',
    'set.sub': '个性化配置与数据管理',
    'set.profileTitle': '👤 个人身体配置',
    'set.weightLabel': '体重 (kg)',
    'set.weightHint': '—— 精确到小数点后一位，用于精确估算跑步机等有氧消耗',
    'set.aiTitle': '🤖 AI 健身教练配置',
    'set.aiDesc': '支持 Anthropic Claude、Google Gemini 与 <strong>ChatGPT（OpenAI）</strong>。API Key 仅保存在本地浏览器中，不上传任何服务器；ChatGPT 订阅与 OpenAI API 用量分开计费。',
    'set.providerLabel': 'AI 模型提供方',
    'set.providerClaude': 'Claude (Anthropic，推荐)',
    'set.providerGemini': 'Gemini (Google)',
    'set.providerOpenai': 'ChatGPT (OpenAI)',
    'set.modelLabel': '模型选择',
    'set.apiKeyLabel': '{provider} API Key',
    'set.hintClaude': '在 <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">Anthropic 控制台</a> 申请 Claude API Key。',
    'set.hintGemini': '在 <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> 免费申请 Gemini API Key。',
    'set.hintOpenai': '在 <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">OpenAI Platform</a> 创建 API Key。开启「Share inputs and outputs with OpenAI」且账户有正余额后，以下模型的共享流量会自动计入免费额度池；ChatGPT 订阅与 API 用量仍分开计算。',
    'set.syncTitle': '☁️ GitHub Pages 自动云同步',
    'set.syncDesc': '利用您已有的 GitHub 账号免费作为云数据库！配置后，手机和电脑端的数据会在保存或加载时自动、私密地合并同步。',
    'set.tokenLabel': 'GitHub Personal Access Token (PAT)',
    'set.tokenHint': '—— 需要 gist 权限',
    'set.gistLabel': 'Gist 标识 (Gist ID)',
    'set.gistHint': '—— 自动生成绑定',
    'set.gistPlaceholder': '保存 Token 并同步会自动绑定，也可手动粘贴别人的 Gist ID',
    'set.syncBtn': '立即同步云端数据',
    'set.backupTitle': '💾 数据导入与导出',
    'set.backupDesc': '为避免浏览器清理缓存导致打卡记录丢失，建议您定期备份数据。',
    'set.export': '导出备份 (JSON)',
    'set.import': '导入备份 (JSON)',
    'set.dangerTitle': '⚠️ 危险操作',
    'set.dangerDesc': '清空所有保存在本地的健身记录。此操作不可逆！',
    'set.resetBtn': '清空所有健身数据',

    'model.claudeOpus': 'Claude Opus 4.8 (最强推理，推荐)',
    'model.claudeSonnet': 'Claude Sonnet 5 (速度与质量兼顾)',
    'model.claudeHaiku': 'Claude Haiku 4.5 (最省，速度快)',
    'model.geminiFlash': 'Gemini 3.7 Flash (最新，推荐)',
    'model.geminiPro': 'Gemini 3.1 Pro (推理能力强，预览版)',
    'model.geminiLite': 'Gemini 3.1 Flash-Lite (最省，速度快)',
    'model.gptTerra': 'GPT-5.6 Terra（默认：日常教练 / 免费 250万）',
    'model.gptSol': 'GPT-5.6 Sol（深度训练复盘 / 免费 25万）',
    'model.gptLuna': 'GPT-5.6 Luna（轻量快速问答 / 免费 250万）',

    'sync.statusLinked': '已关联云端存储',
    'sync.statusToken': '已配置Token，待首次同步',
    'sync.statusNone': '未配置同步',
    'sync.needToken': '请先在设置中配置您的 GitHub Personal Access Token (PAT)！',
    'sync.syncing': '正在云同步...',
    'sync.connecting': '正在连接 GitHub...',
    'sync.searching': '正在云端检索已有存储...',
    'sync.found': '已找到云端已有存储，正在绑定...',
    'sync.searchFailed': '云端检索失败，将尝试直接新建: ',
    'sync.creating': '正在创建全新私有云存储...',
    'sync.created': '已成功创建并绑定私有云存储！',
    'sync.pulling': '正在拉取云端健身记录...',
    'sync.gistDeleted': '云端绑定的存储已被删除，已为您重置。请重新点击同步以新建云存储！',
    'sync.merging': '正在融合双端记录...',
    'sync.uploading': '正在上传备份到云端...',
    'sync.clearingCloud': '⌛ 正在同步清空云端...',

    'msg.needValidGroup': '请至少填写一组有效的次数与组数！',
    'msg.needCustomName': '请输入自定义项目的运动名称！',
    'msg.editSaved': '✅ 修改已保存！',
    'msg.logged': '🎉 打卡成功！',
    'msg.needBodyMetric': '请至少填写一项身体数据！',
    'msg.bodyUpdated': '✅ 身体数据已更新！',
    'msg.bodyRecorded': '📏 身体数据已记录！',
    'msg.confirmDeleteMetric': '确定删除这条身体数据吗？',
    'msg.confirmDeleteWorkout': '确定要删除这条打卡记录吗？此操作无法撤销。',
    'msg.confirmDeleteChat': '确定要删除这段对话记录吗？此操作无法撤销。',
    'msg.needValidGroupRec': '请至少保留一个有效的重量组（每组次数和组数都必须大于 0）。',
    'msg.needValidSegments': '请填写有效的变速段与总时长。',
    'msg.copySuccess': '复制成功！可以直接粘贴给网页版 Gemini / ChatGPT 了。',
    'msg.copySuccessFallback': '复制成功！(降级通道)',
    'msg.importSuccess': '🎉 数据合并导入成功！电脑与手机的数据已完美融合。',
    'msg.importInvalid': '导入失败：非合法的 GymNote 备份 JSON 文件。',
    'msg.importParseError': '导入失败：文件解析错误。',
    'msg.confirmReset1': '🚨 警告：这会清空你本地存储的全部健身打卡数据！确定要继续吗？',
    'msg.confirmReset2': '再一次确认：确定要彻底清除数据吗？（保留您的 API Key 和体重配置，仅清空本地和云端的打卡历史记录）',
    'msg.syncSuccess': '🎉 双端数据云同步成功！打卡记录已无损合并。',
    'err.cloudUpdate': '云端数据更新失败',
    'err.clearCloud': '⚠️ 清空 GitHub 云端数据失败，将仅清空本地数据。错误: ',
    'err.claude': '请求 Claude 失败，请检查 API Key 是否有效。',
    'err.claudeSafety': 'Claude 出于安全策略拒绝了本次请求，请换一种问法。',
    'err.openai': '请求 OpenAI 失败，请检查 API Key 与账户额度。',
    'err.openaiEmpty': 'OpenAI 没有返回可显示的文本。',
    'err.gemini': '请求 Gemini 失败，请检查 API Key 是否有效。',

    'type.leg_press': '腿举',
    'type.shoulder_press': '肩推',
    'type.chest_press': '胸推',
    'type.preacher_curl': '牧师椅',
    'type.lat_pulldown': '高位下拉',
    'type.situps': '仰卧起坐',
    'type.spin_bike': '动感单车',
    'type.treadmill': '跑步机',
    'type.massage_chair': '按摩椅',
    'type.body_metrics': '身体数据',
    'type.custom': '自定义',

    'cat.strength': '力量',
    'cat.core': '核心',
    'cat.cardio': '有氧',
    'cat.relax': '放松',
    'cat.body': '体测',
    'cat.other': '其他',
    'cat.strengthFull': '力量训练',
    'cat.coreFull': '腰腹核心',
    'cat.cardioFull': '有氧燃脂',
    'cat.relaxFull': '拉伸放松',
    'cat.bodyFull': '身体数据 (Body Metrics)',
    'cat.customFull': '自定义项目 (Custom)',

    'part.legs': '腿部',
    'part.chest': '胸部',
    'part.back': '背部',
    'part.shoulder': '肩部',
    'part.core': '核心',
    'part.arm': '手臂',
    'part.cardio': '有氧',
    'part.recovery': '放松恢复',
    'part.other': '其他',

    'metric.weight': '体重',
    'metric.arm': '臂围',
    'metric.waist': '腰围',
    'metric.chest': '胸围',

    'mode.auto': '自动舒缓',
    'mode.neck': '颈肩重点',
    'mode.stretch': '全身拉伸',
    'mode.hip': '腰臀放松',
    'dur.m15': '15 分钟',
    'dur.m30': '30 分钟',
    'dur.m45': '45 分钟',
    'dur.h1': '1 小时',
    'dur.h1m15': '1 小时 15 分',
    'dur.h1m30': '1 小时 30 分',
    'dur.h1m45': '1 小时 45 分',
    'dur.h2': '2 小时',

    'unit.min': '分钟',
    'unit.gear': '档',
    'unit.times': '次',
    'wd.sun': '周日', 'wd.mon': '周一', 'wd.tue': '周二', 'wd.wed': '周三',
    'wd.thu': '周四', 'wd.fri': '周五', 'wd.sat': '周六',
    'week.3ago': '3周前', 'week.2ago': '2周前', 'week.last': '上周', 'week.this': '本周',

    'equip.legPressNote': '力量训练，练下肢',
    'equip.shoulderPressNote': '力量训练，练肩部',
    'equip.chestPressNote': '力量训练，练胸部',
    'equip.preacherCurlNote': '力量训练，练肱二头肌',
    'equip.latPulldownNote': '力量训练，练背部',
    'equip.situpsNote': '核心训练',
    'equip.spinBikeNote': '有氧训练',
    'equip.treadmillNote': '有氧训练',
    'equip.massageChairNote': '拉伸放松，非力量/有氧训练',

    'mock.note1': '热身快走',
    'mock.note2': '腿举第2台机器',
    'mock.note3': '感觉右肩稍沉',
    'mock.note4': '阻力偏轻',
    'mock.note5': '胸推，状态良好',
    'mock.note6': '全身酸痛按摩',
    'mock.note7': '加重量了，小腿有点酸',
    'mock.note8': '腰腹练习',
    'mock.note9': '今天跑得很爽，浑身湿透'
  }
};
