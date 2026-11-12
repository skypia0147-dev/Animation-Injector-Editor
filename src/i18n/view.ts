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
  'row.otherView': ['View switch', '시점 전환', '視点切り替え', '视角切换'],
  'tip.otherView': [
    'The player uses this action while the camera is in the other view. Off: it does not start. On: the camera switches to the action’s view, plays it, and returns when it ends. Needs runtime 1.0.8 or later.',
    '플레이어가 다른 인칭 카메라에서 이 동작을 쓸 때입니다. 끄면 시작하지 않습니다. 켜면 동작의 인칭으로 카메라를 바꿔 재생하고, 끝나면 원래 인칭으로 돌아갑니다. 런타임 1.0.8 이상이 필요합니다.',
    'プレイヤーが別の視点のカメラでこのアクションを使うときです。オフ: 開始しません。オン: アクションの視点にカメラを切り替えて再生し、終了後に元の視点へ戻ります。ランタイム 1.0.8 以上が必要です。',
    '玩家在另一视角的镜头下使用此动作时。关闭：不启动。开启：将镜头切换到动作的视角播放，结束后回到原视角。需要运行时 1.0.8 或更高版本。',
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
  'view.pairDefault': ['{view} (pair default)', '{view} (페어 기본)', '{view}(ペア既定)', '{view}（配对默认）'],
  'view.pairFirst': [
    'Starts in first person only. The first-person file plays both roles.',
    '1인칭에서만 시작합니다. 1인칭 파일 하나로 두 역할을 재생합니다.',
    '一人称でのみ開始します。一人称ファイルひとつで両方の役を再生します。',
    '仅在第一人称时开始。一个第一人称文件播放两个角色。',
  ],
  'view.fixedCarry': ['Third person (carry)', '3인칭 (운반 고정)', '三人称(運搬固定)', '第三人称（搬运固定）'],
  'view.pairBoth': [
    'In first person it plays the first-person file, in third person the third-person file.',
    '1인칭이면 1인칭 파일로, 3인칭이면 3인칭 파일로 재생합니다.',
    '一人称なら一人称ファイル、三人称なら三人称ファイルで再生します。',
    '第一人称时播放第一人称文件，第三人称时播放第三人称文件。',
  ],
  'view.fixedPutdown': [
    'Third person (carry putdown)',
    '3인칭 (운반 내려놓기 고정)',
    '三人称(運搬の下ろし固定)',
    '第三人称（搬运放下固定）',
  ],
  'view.block': ['Do not start', '시작 안 함', '開始しない', '不启动'],
  'view.switchThird': [
    'Switch to third person to play',
    '3인칭으로 바꿔서 재생',
    '三人称に切り替えて再生',
    '切换到第三人称播放',
  ],
  'view.switchFirst': [
    'Switch to first person to play',
    '1인칭으로 바꿔서 재생',
    '一人称に切り替えて再生',
    '切换到第一人称播放',
  ],
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
