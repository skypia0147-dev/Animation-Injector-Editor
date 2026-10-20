export const extensionsEn = {
  'node.fireArrow': 'Fire bow',
  'fireArrow.at': 'Release time',
  'fireArrow.hint':
    'Player bow only. Releases the current draw through the native attack action once per step. If already released manually, it is skipped. The event is registered automatically; time or fallback uses seconds from clip start.',
  'node.carryRelease': 'Release carried target',
  'carryRelease.at': 'Release time',
  'carryRelease.hint':
    'Putdown action of a carry: at this moment the carried target is let go and falls as a ragdoll. Time and fallback are seconds from the clip start; an event is an HKX annotation name. If the clip ends first, the target is let go at the end.',
  'node.carryFix': 'Fix carried target',
  'carryFix.at': 'Fix time',
  'carryFix.hint':
    "Lift pair of a carry: the moment the target keeps the pose it has then and starts following the carrier bone. By default the lift's end; a set time moves it earlier into the lift (seconds from the lift clip start; events are not supported). Physics starts after the lift ends.",
  'carryFix.liftEnd': 'Lift end',
  'carryFix.time': 'Set time',
  'node.extraEvents': 'Register HKX events',
  'node.suppress': 'Suppress native events',
  'ext.eventNames': 'Event names',
  'ext.extraEventsHint':
    'Register names used by HKX annotations. One name per line or comma. This does not emit events. Case-insensitive duplicates are registered once. Maximum 64 UTF-8 bytes per name.',
  'ext.suppressHint':
    'Player only. Suppress these native animation graph events; this does not block physical keys or inject input. One name per line or comma.',
  'ext.suppressWhen': 'When',
  'ext.suppressWhenHint':
    'Startable: only when the input can actually start an eligible action, including its direction and condition flow. Active: while this action or its selected flow destination is playing.',
  'ext.startable': 'When startable',
  'ext.active': 'While active',
  'ext.both': 'Startable or active',
  'ext.equippedType': 'Equipped type',
  'ext.attackState': 'Attack state',
  'ext.sneaking': 'Sneaking',
  'ext.hand': 'Hand',
  'ext.left': 'Left',
  'ext.right': 'Right',
  'ext.equipmentType': 'Equipment type',
  'ext.state': 'Attack state',
};
export const extensionsKo = {
  'node.fireArrow': '활 발사',
  'fireArrow.at': '발사 시점',
  'fireArrow.hint':
    '플레이어의 활에만 적용합니다. 현재 당긴 화살을 엔진 공격 해제 경로로 Step당 한 번 발사 요청합니다. 이미 직접 놓았다면 건너뜁니다. 이벤트는 자동 등록되며, 시각·대체값은 클립 시작 기준 초입니다.',
  'node.carryRelease': '대상 놓기',
  'carryRelease.at': '놓는 시점',
  'carryRelease.hint':
    '운반의 내려놓기 동작에서 이 시점에 들고 있던 대상을 놓아 래그돌로 떨어뜨립니다. 시각·대체값은 클립 시작 기준 초, 이벤트는 HKX 주석 이름입니다. 클립이 먼저 끝나면 끝에서 놓습니다.',
  'node.carryFix': '대상 고정',
  'carryFix.at': '고정 시점',
  'carryFix.hint':
    '운반의 들기 페어에서 대상이 그 순간 자세 그대로 운반자 뼈를 따라가기 시작하는 시점입니다. 기본은 들기 끝이며, 시점을 지정하면 들기 도중으로 앞당깁니다(들기 클립 시작 기준 초, 이벤트는 지원하지 않음). 물리는 들기가 끝난 뒤 시작합니다.',
  'carryFix.liftEnd': '들기 끝',
  'carryFix.time': '시점 지정',
  'node.extraEvents': 'HKX 이벤트 등록',
  'node.suppress': '바닐라 이벤트 차단',
  'ext.eventNames': '이벤트 이름',
  'ext.extraEventsHint':
    'HKX 주석에 사용한 이름을 등록합니다. 이벤트를 발생시키는 기능은 아닙니다. 한 줄에 하나 또는 쉼표로 구분하세요. 대소문자만 다른 중복은 한 번 등록하며 이름당 UTF-8 64바이트까지 허용합니다.',
  'ext.suppressHint':
    '플레이어의 지정한 바닐라 애니메이션 그래프 이벤트만 차단합니다. 물리 키 차단·입력 주입 기능은 아닙니다. 한 줄에 하나 또는 쉼표로 구분하세요.',
  'ext.suppressWhen': '차단 시점',
  'ext.suppressWhenHint':
    '시작 가능 시: 방향·조건 분기 등 실제 시작 조건을 통과한 입력에서만 차단합니다. 재생 중: 이 동작 또는 분기로 선택한 목적지를 재생할 때 차단합니다.',
  'ext.startable': '시작 가능 시',
  'ext.active': '재생 중',
  'ext.both': '시작 가능 시 + 재생 중',
  'ext.equippedType': '장착 종류',
  'ext.attackState': '공격 상태',
  'ext.sneaking': '은신 중',
  'ext.hand': '검사할 손',
  'ext.left': '왼손',
  'ext.right': '오른손',
  'ext.equipmentType': '장착 종류',
  'ext.state': '공격 상태',
};
