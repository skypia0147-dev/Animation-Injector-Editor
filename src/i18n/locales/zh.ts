import {eastAsian} from '../eastAsian.ts';
import {finishZh} from '../finish.ts';
import {extensionsEn} from '../extensions.ts';
import {viewZh} from '../view.ts';
export const zh: Record<string, string> = {
  'node.qte': 'QTE',
  ...viewZh,
  'node.carry': '搬运',
  ...Object.fromEntries(Object.entries(eastAsian).map(([key, value]) => [key, value[1]])),
  ...extensionsEn,
  'node.carryRelease': '放下搬运目标',
  'carryRelease.at': '放下时刻',
  'carryRelease.hint':
    '在搬运的放下动作中，于此时刻放开所持目标，使其以布娃娃方式落下。时间与备用值为距剪辑开始的秒数，事件为 HKX 注释名。若剪辑先结束，则在结束时放开。',
  'node.carryFix': '固定搬运目标',
  'carryFix.at': '固定时刻',
  'carryFix.hint':
    '在搬运的抬起配对中，目标保持当下姿势并开始跟随搬运者骨骼的时刻。默认为抬起结束；指定时刻则提前到抬起过程中（距抬起剪辑开始的秒数，不支持事件）。物理在抬起结束后开始。',
  'carryFix.liftEnd': '抬起结束',
  'carryFix.time': '指定时刻',
  ...finishZh,
};
