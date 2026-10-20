// Camera views (view.ts, runtime 0.12.225): [English, Korean, Japanese, Simplified Chinese].
const entries: Record<string, [string, string, string, string]> = {
  'row.view': ['View', '인칭', '視点', '视角'],
  'tip.view': [
    'Where the action plays: the third-person graphs (NPCs and the third-person player), the player’s first-person graph, or both. Switching view while it plays cancels it.',
    '재생되는 곳: 3인칭 그래프(NPC·3인칭 플레이어), 플레이어의 1인칭 그래프, 또는 둘 다입니다. 재생 중 1인칭·3인칭을 바꾸면 취소됩니다.',
    '再生される場所: 三人称グラフ(NPC・三人称のプレイヤー)、プレイヤーの一人称グラフ、または両方。再生中に視点を切り替えると中止されます。',
    '播放位置：第三人称图（NPC 与第三人称玩家）、玩家的第一人称图，或两者。播放中切换视角会取消该动作。',
  ],
  'row.projectView': ['Default view', '기본 인칭', '既定の視点', '默认视角'],
  'tip.projectView': [
    'The view of actions that do not choose their own. Pairs and carries always play in third person.',
    '인칭을 따로 정하지 않은 동작의 인칭입니다. 페어와 운반은 항상 3인칭입니다.',
    '個別に視点を決めていないアクションの視点です。ペアと運搬は常に三人称です。',
    '未单独设置视角的动作所用的视角。配对与搬运始终为第三人称。',
  ],
  'row.firstPerson': ['In first person', '1인칭에서', '一人称では', '第一人称时'],
  'tip.firstPerson': [
    'The player uses this third-person action with a first-person camera: do not start it, or switch to third person and return to first person when it ends.',
    '1인칭 카메라에서 플레이어가 이 3인칭 동작을 쓰면: 시작하지 않거나, 3인칭으로 바꿔 재생하고 끝나면 1인칭으로 돌아갑니다.',
    'プレイヤーが一人称カメラでこの三人称アクションを使うと: 開始しない、または三人称に切り替えて再生し、終了後に一人称へ戻ります。',
    '玩家在第一人称镜头下使用此第三人称动作时：不启动，或切换到第三人称播放并在结束后回到第一人称。',
  ],
  'view.third': ['Third person', '3인칭', '三人称', '第三人称'],
  'view.first': ['First person', '1인칭', '一人称', '第一人称'],
  'view.both': ['Both', '둘 다', '両方', '两者'],
  'view.default': [
    '{view} (project default)',
    '{view} (프로젝트 기본)',
    '{view}(プロジェクト既定)',
    '{view}（项目默认）',
  ],
  'view.fixedPair': ['Third person (pair)', '3인칭 (페어 고정)', '三人称(ペア固定)', '第三人称（配对固定）'],
  'view.fixedPutdown': [
    'Third person (carry putdown)',
    '3인칭 (운반 내려놓기 고정)',
    '三人称(運搬の下ろし固定)',
    '第三人称（搬运放下固定）',
  ],
  'view.block': ['Do not start', '시작 안 함', '開始しない', '不启动'],
  'view.switch': ['Switch to third person', '3인칭으로 전환', '三人称に切り替え', '切换到第三人称'],
  'view.cancelThird': [
    'Switching to first person while it plays cancels it.',
    '재생 중 1인칭으로 바꾸면 취소됩니다.',
    '再生中に一人称へ切り替えると中止されます。',
    '播放中切换到第一人称会取消。',
  ],
  'view.cancelFirst': [
    'Switching to third person while it plays cancels it.',
    '재생 중 3인칭으로 바꾸면 취소됩니다.',
    '再生中に三人称へ切り替えると中止されます。',
    '播放中切换到第三人称会取消。',
  ],
  'view.cancelBoth': [
    'Plays in the view it starts in; switching view while it plays cancels it.',
    '시작할 때의 인칭으로 재생하고, 재생 중 인칭을 바꾸면 취소됩니다.',
    '開始した視点で再生し、再生中に視点を切り替えると中止されます。',
    '以开始时的视角播放，播放中切换视角会取消。',
  ],
  'viewport.person': ['Preview person', '미리보기 인칭', 'プレビューの視点', '预览视角'],
  'viewport.camera': ['First-person camera', '1인칭 카메라', '一人称カメラ', '第一人称镜头'],
  'viewport.cameraHelp': [
    'Through the first-person camera bone, as the game shows it. Middle button: look around · Wheel: field of view · Home: look straight ahead',
    '게임 화면처럼 1인칭 카메라 본에서 봅니다. 가운데 버튼: 둘러보기 · 휠: 시야각 · 기본 시점 복귀: 정면',
    'ゲーム画面のように一人称カメラのボーンから見ます。中ボタン: 見回す · ホイール: 視野角 · 既定の視点に戻す: 正面',
    '像游戏画面一样从第一人称镜头骨骼观看。中键：环顾 · 滚轮：视野角 · 恢复默认视角：正前方',
  ],
  'view.thirdFile': ['Third-person file', '3인칭 파일', '三人称ファイル', '第三人称文件'],
  'view.firstFile': ['First-person file', '1인칭 파일', '一人称ファイル', '第一人称文件'],
  'tip.firstFile': [
    'The HKX under meshes\\actors\\character\\_1stPerson with the same relative path as the clip.',
    '클립과 같은 상대 경로로 meshes\\actors\\character\\_1stPerson 아래에 있는 HKX입니다.',
    'クリップと同じ相対パスで meshes\\actors\\character\\_1stPerson の下にある HKX です。',
    '位于 meshes\\actors\\character\\_1stPerson 下、与剪辑相对路径相同的 HKX。',
  ],
};
const column = (i: number) => Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v[i]]));
export const viewEn = column(0);
export const viewKo = column(1);
export const viewJa = column(2);
export const viewZh = column(3);
