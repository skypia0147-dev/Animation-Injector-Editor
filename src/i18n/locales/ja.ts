import {eastAsian} from '../eastAsian.ts';
import {finishJa} from '../finish.ts';
import {extensionsEn} from '../extensions.ts';
import {viewJa} from '../view.ts';
export const ja: Record<string, string> = {
  'node.qte': 'QTE',
  ...viewJa,
  'node.carry': '運搬',
  ...Object.fromEntries(Object.entries(eastAsian).map(([key, value]) => [key, value[0]])),
  ...extensionsEn,
  'node.carryRelease': '運搬対象を放す',
  'carryRelease.at': '放す時点',
  'carryRelease.hint':
    '運搬の下ろしアクションで、この時点に持っている対象を放してラグドールで落とします。時刻・代替値はクリップ開始からの秒、イベントは HKX 注釈名です。クリップが先に終わると終わりで放します。',
  'node.carryFix': '運搬対象を固定',
  'carryFix.at': '固定時点',
  'carryFix.hint':
    '運搬の持ち上げペアで、対象がその瞬間の姿勢のまま運搬者のボーンに追従し始める時点です。既定は持ち上げの終わりで、時点を指定すると持ち上げの途中に早めます(持ち上げクリップ開始からの秒、イベントは使えません)。物理は持ち上げの終了後に始まります。',
  'carryFix.liftEnd': '持ち上げの終わり',
  'carryFix.time': '時点を指定',
  ...finishJa,
};
