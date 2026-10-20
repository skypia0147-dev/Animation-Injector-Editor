const entries: Record<string, [string, string]> = {
  'graph.comment': ['Comment', '코멘트'],
  'graph.copy': ['Copy', '복사'],
  'graph.singleton': [
    'Only one card of this kind is supported by this graph.',
    '이 그래프에서는 이 종류의 카드를 한 개만 사용할 수 있습니다.',
  ],
  'graph.anim': ['Animation graph', '애님 그래프'],
  'graph.entryRule': ['Entry rule', '진입 룰'],
  'graph.missingClip': ['Assign an HKX file', 'HKX 파일을 지정하세요'],
  'graph.emptyRule': ['Choose a trigger', '트리거를 지정하세요'],
  'graph.selectState': ['Select an action first.', '먼저 동작을 선택하세요.'],
  'graph.selectNode': ['Select a card to edit its properties.', '카드를 선택하면 해당 속성을 편집합니다.'],
  'graph.registryHint': [
    'Event names and their functions are edited in the Event Registry card on the graph.',
    '이벤트 이름과 기능은 그래프의 이벤트 등록 카드에서 편집합니다.',
  ],
  'graph.unsupported': [
    'This graph cannot express that connection in the runtime XML.',
    '현재 그래프의 런타임 XML에서 지원하지 않는 연결입니다.',
  ],
  'graph.requiredNode': [
    'This structural card is required. Edit its properties instead.',
    '필수 구조 카드는 제거할 수 없습니다. 디테일에서 값을 편집하세요.',
  ],
  'graph.selfLink': ['Connect two different actions.', '서로 다른 동작을 연결하세요.'],
  'graph.pinMismatch': ['The pin types do not match.', '서로 다른 종류의 핀은 연결할 수 없습니다.'],
  'graph.canonical': [
    'This connection conflicts with the runtime order or single-input limit. Use the existing input or remove its card first.',
    '런타임 순서 또는 입력 한 개 제한과 충돌합니다. 기존 입력을 편집하거나 해당 카드를 먼저 제거하세요.',
  ],
  'graph.searchNodes': ['Search cards', '카드 검색'],
  'graph.inputConflict': [
    'An input with that ID already has different settings.',
    '같은 ID의 입력이 다른 설정으로 존재합니다.',
  ],
  'graph.openRule': ['Open rule', '룰 열기'],
  'graph.entryHint': [
    'Connect Entry to an action to define its entry rule.',
    '진입에서 동작으로 연결하면 진입 룰을 설정할 수 있습니다.',
  ],
  'graph.chooseInput': ['Select an input', '입력을 선택하세요'],
  'graph.resultHint': [
    'One trigger and at most one state condition determine entry.',
    '트리거 한 개와 상태 조건으로 진입 여부를 결정합니다.',
  ],
};
export const graphEn = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v[0]]));
export const graphKo = Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v[1]]));
