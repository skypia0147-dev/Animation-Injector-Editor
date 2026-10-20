import {HelpNote} from '../ui/HelpTip.tsx';
import type {Workspace} from '../workspace.ts';
import {blendNodes, blendBinding, editBlend, animId} from './blends.ts';
import {flatGraph, connectFlat} from './flat.ts';
import {DetailPanel, DetailCategory, DetailRow} from '../ui/details/DetailRow.tsx';
import {Property} from '../ui/details/Property.tsx';
import {t} from '../i18n/index.ts';
import {tr} from '../i18n/korean.ts';

export function BlendDetails({
  w,
  id,
  edit,
  status,
}: {
  w: Workspace;
  id: string;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
}) {
  const b = blendNodes(w).find(b => b.id === id);
  if (!b) return null;
  const members = w.sharedRules?.find(g => g.kind === 'node' && g.members.includes(id))?.members ?? [id];
  const bindings = blendNodes(w).filter(b => members.includes(b.id));
  let role = tr('연결 필요');
  let exitBlend = false;
  try {
    const binding = blendBinding(w, b);
    role = binding.label;
    exitBlend = binding.kind === 'exit';
  } catch {
    /* Draft. */
  }
  const options = flatGraph(w).nodes.filter(n =>
    ['entry', 'state', 'hkxPlay', 'keyInput', 'markerReceive', 'result', 'outputPose'].includes(n.kind)
  );
  return (
    <DetailPanel>
      <DetailCategory title={t('row.blend')} initialOpen>
        <Property
          id="blend"
          hint={exitBlend ? t('tip.exitMovementBlend') : undefined}
          value={b.seconds}
          change={seconds => edit(w => editBlend(w, id, {seconds: Number(seconds)}))}
          min={0}
          max={5}
          step={0.05}
        />
        <HelpNote label={tr('적용 위치: ') + role}>{tr('연결 방향으로 시작·종료·동작 간 전환이 결정됩니다.')}</HelpNote>
        {bindings.length > 1 && (
          <DetailRow
            label={tr('공유 적용 · {length}개 경로', {length: bindings.length})}
            hint={tr('시간은 모든 경로에서 공유합니다. 연결선 하나를 끊으면 그 경로의 블렌드만 해제됩니다.')}
          >
            <div>
              {bindings.map(binding => {
                let text = tr('연결 필요');
                try {
                  const r = blendBinding(w, binding);
                  text = (w.actions.find(a => a.uid === r.action)?.config.name ?? r.action) + ' · ' + r.label;
                } catch {
                  /* Pending connection. */
                }
                return <div key={binding.id}>{text}</div>;
              })}
            </div>
          </DetailRow>
        )}
        {(['source', 'target'] as const).map(side => (
          <DetailRow key={side} label={side === 'source' ? tr('이전 카드') : tr('다음 카드')}>
            <select
              aria-label={side === 'source' ? tr('블렌드 이전 카드') : tr('블렌드 다음 카드')}
              value={b[side]}
              onChange={e => {
                const value = e.target.value;
                try {
                  edit(w =>
                    value
                      ? connectFlat(w, side === 'source' ? value : id, side === 'source' ? id : value)
                      : editBlend(w, id, {[side]: ''})
                  );
                } catch (e) {
                  status(String(e));
                }
              }}
            >
              <option value="">{tr('연결 없음')}</option>
              {side === 'target' &&
                w.actions
                  .filter(a => a.nodeAuthored && !options.some(n => n.id === animId(a.uid, 'outputPose')))
                  .map(a => (
                    <option key={a.uid} value={animId(a.uid, 'outputPose')}>
                      {tr('동작 끝 ·')} {a.config.name}
                    </option>
                  ))}
              {options.map(n => (
                <option key={n.id} value={n.id}>
                  {n.kind === 'outputPose'
                    ? tr('동작 끝 · {v0}', {v0: w.actions.find(a => a.uid === n.action)?.config.name ?? n.action})
                    : `${n.title} · ${n.summary} (${n.id})`}
                </option>
              ))}
            </select>
          </DetailRow>
        ))}
        <HelpNote label={tr('블렌드 연결 방식')}>
          {tr('입력 → 블렌드 → 동작: 시작')}
          <br />
          {tr('HKX → 블렌드 → 재생 종료: 종료 (종료 카드 생략 시 기본 종료)')}
          <br />
          {tr('동작/HKX → 블렌드 → 동작/HKX: 전환')}
        </HelpNote>
        <HelpNote label={tr('지원 범위')}>
          {tr(
            '단일 일반 HKX 사이는 경로별로 직접 블렌드합니다 (DLL 0.12.7 이상). 페어·여러 클립 동작 연결은 기존 대상 진입 블렌드를 사용하며, 같은 대상의 진입 시간이 다르면 충돌을 알립니다.'
          )}
        </HelpNote>
      </DetailCategory>
    </DetailPanel>
  );
}
