import {HelpNote} from './ui/HelpTip.tsx';
import {useEffect, useRef, useState} from 'react';
import type {Workspace} from './workspace';
import {Field} from './Inspector';
import {
  assets,
  assetKey,
  selectAsset,
  selectSound,
  sounds,
  policy,
  plugins,
  request,
  packageProblems,
  packageNotices,
  runtimeSummary,
} from './package';
import {MINIMUM_RUNTIME_VERSION} from './xmlFormat.ts';
import type {PackageReport, ReportRow, RuntimeVerdict} from './package';
import {t} from './i18n/index.ts';
import * as io from './io';
import {tr} from './i18n/korean.ts';

function RuntimeStatus({verdict}: {verdict: RuntimeVerdict}) {
  if (!verdict.available)
    return <p className="warning-status">{t('export.runtimeUnavailable', {problem: verdict.problem})}</p>;
  if (!verdict.valid)
    return <p className="error-status">{t('export.runtimeRejected', {error: runtimeSummary(verdict)})}</p>;
  return (
    <>
      <p className="ok-status">{t('export.runtimeOk', {n: verdict.actions.length})}</p>
      {verdict.warnings.map(s => (
        <p key={s} className="warning-status">
          {t('export.runtimeWarning', {text: s})}
        </p>
      ))}
    </>
  );
}

/** One file of the package, an HKX or a sound: copy it (its source found or chosen) or name who provides it. */
function AssetRow({
  name,
  copyText,
  file,
  row,
  busy,
  edit,
  choose,
  clear,
  pick,
}: {
  name: string;
  /** The copy choice's words: an HKX's by default. */
  copyText?: string;
  file: {paths: string[]; mode: 'copy' | 'external'; dependency: string};
  row?: ReportRow;
  busy: boolean;
  edit: (fn: (w: Workspace) => Workspace) => void;
  choose: () => void;
  clear: () => void;
  pick: (path: string) => void;
}) {
  return (
    <fieldset disabled={busy} className="package-asset">
      <legend>{name}</legend>
      <div className="package-asset-controls">
        <select
          aria-label={t('export.policy') + ' ' + name}
          value={file.mode}
          onChange={e => edit(w => policy(w, name, e.target.value as 'copy' | 'external', file.dependency))}
        >
          <option value="copy">{copyText ?? t('export.copy')}</option>
          <option value="external">{t('export.external')}</option>
        </select>
        {file.mode === 'copy' ? (
          <>
            <button onClick={choose}>{t('export.source')}</button>
            <button disabled={!file.paths.length} onClick={clear}>
              {t('export.clearSource')}
            </button>
          </>
        ) : (
          <input
            aria-label={t('export.provider') + ' ' + name}
            value={file.dependency}
            placeholder={t('export.provider')}
            onChange={e => edit(w => policy(w, name, 'external', e.target.value))}
          />
        )}
      </div>
      {file.paths.map(path => (
        <p className="asset-path" key={path}>
          {path}
        </p>
      ))}
      <p className={row?.status === 'ready' || row?.status === 'external' ? 'ok-status' : 'warning-status'}>
        {row?.message ??
          t(
            file.mode === 'external'
              ? 'export.externalHint'
              : file.paths.length
                ? 'export.sourceHint'
                : 'export.missingHint'
          )}
      </p>
      {row?.status === 'ambiguous' && (
        <Field label={t('export.candidate')}>
          <select
            defaultValue=""
            onChange={e => {
              if (e.target.value) pick(e.target.value);
            }}
          >
            <option value="">{t('export.choose')}</option>
            {row.candidates.map(c => (
              <option key={c.path} value={c.path}>
                {c.path} ({c.size} bytes)
              </option>
            ))}
          </select>
        </Field>
      )}
      {row?.sha256 && <HelpNote label={tr('파일 검증')}>SHA-256 {row.sha256}</HelpNote>}
    </fieldset>
  );
}

export function PackagePanel({
  w,
  edit,
  status,
  busy,
  setBusy,
}: {
  w: Workspace;
  edit: (fn: (w: Workspace) => Workspace) => void;
  status: (s: string) => void;
  busy: boolean;
  setBusy: (v: boolean) => void;
}) {
  const [report, setReport] = useState<PackageReport | null>(null);
  const [message, setMessage] = useState('');
  const current = useRef(w);
  current.current = w;
  const signature = JSON.stringify(w);
  useEffect(() => {
    setReport(null);
    setMessage('');
  }, [signature]);
  const files = assets(w),
    played = sounds(w),
    problems = packageProblems(w),
    notices = packageNotices(w);
  const patch = (values: Partial<typeof w.packaging>) =>
    edit(w => {
      w.packaging = {...w.packaging, ...values};
      return w;
    });
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage(String(e));
      status(String(e));
    } finally {
      setBusy(false);
    }
  };
  const unchanged = (before: Workspace) => {
    if (current.current !== before) throw new Error(t('export.changed'));
  };
  const choose = (clip: string) =>
    run(async () => {
      const before = w,
        selected = await io.pickHkx();
      unchanged(before);
      if (!selected) return;
      if (assetKey(selected.clip) !== assetKey(clip)) throw new Error(t('export.pathMismatch'));
      edit(w => selectAsset(w, clip, selected.path));
    });
  const chooseSound = (file: string) =>
    run(async () => {
      const before = w,
        selected = await io.pickSound();
      unchanged(before);
      if (!selected) return;
      if (assetKey(selected.file) !== assetKey(file))
        throw new Error(tr('고른 파일의 sound 아래 경로가 함수의 소리 파일과 다릅니다.'));
      edit(w => selectSound(w, file, selected.path));
    });
  const probe = () =>
    run(async () => {
      const before = w,
        result = await io.probePackage(request(w));
      unchanged(before);
      setReport(result);
      setMessage('');
    });
  const output = () =>
    run(async () => {
      if (!report?.ready) throw new Error(t('export.initial'));
      const result = await io.exportMod(request(w, report));
      if (result) {
        const text = t('export.done', {
          path: result.path,
          files: result.files,
          size: (result.bytes / 1048576).toFixed(2),
        });
        setMessage(text);
        status(text);
      }
    });
  return (
    <div className="package-panel">
      <div className="package-body">
        <div className="package-top">
          <Field label={t('detail.folder')}>
            <input disabled={busy} value={w.packaging.folder} onChange={e => patch({folder: e.target.value})} />
          </Field>
        </div>
        <fieldset disabled={busy} className="package-roots">
          <legend>{t('export.roots')}</legend>
          {w.packaging.roots.map((root, i) => (
            <div className="row-actions" key={root}>
              <span className="asset-path">{root}</span>
              <button onClick={() => patch({roots: w.packaging.roots.filter((_, j) => j !== i)})}>
                {t('menu.edit.delete')}
              </button>
            </div>
          ))}
          <button
            disabled={busy || w.packaging.roots.length >= 12}
            onClick={() =>
              void run(async () => {
                const before = w,
                  root = await io.pickAssetRoot();
                unchanged(before);
                if (root && !w.packaging.roots.some(p => assetKey(p) === assetKey(root)))
                  patch({roots: [...w.packaging.roots, root]});
              })
            }
          >
            {t('export.addRoot')}
          </button>
          <HelpNote label={t('export.roots')}>{t('export.rootHint')}</HelpNote>
        </fieldset>
        <div className="package-summary">
          <b>{t('export.assets', {n: files.length})}</b>
          <span>
            {t('export.counts', {
              copy: files.filter(a => a.mode === 'copy').length,
              external: files.filter(a => a.mode === 'external').length,
            })}
          </span>
          <span>{report ? (report.totalBytes / 1048576).toFixed(2) + ' MB' : t('export.unchecked')}</span>
        </div>
        <div className="package-assets">
          {files.map(file => (
            <AssetRow
              key={assetKey(file.clip)}
              name={file.clip}
              file={file}
              row={report?.assets.find(r => assetKey(r.clip) === assetKey(file.clip))}
              busy={busy}
              edit={edit}
              choose={() => void choose(file.clip)}
              clear={() => edit(w => selectAsset(w, file.clip, ''))}
              pick={path => edit(w => selectAsset(w, file.clip, path))}
            />
          ))}
        </div>
        {played.length > 0 && (
          <>
            <div className="package-summary">
              <b>{tr('소리 파일 {n}개', {n: played.length})}</b>
            </div>
            <div className="package-assets">
              {played.map(sound => (
                <AssetRow
                  key={assetKey(sound.file)}
                  name={sound.file}
                  copyText={tr('소리 파일 복사 포함')}
                  file={sound}
                  row={report?.sounds.find(r => assetKey(r.clip) === assetKey(sound.file))}
                  busy={busy}
                  edit={edit}
                  choose={() => void chooseSound(sound.file)}
                  clear={() => edit(w => selectSound(w, sound.file, ''))}
                  pick={path => edit(w => selectSound(w, sound.file, path))}
                />
              ))}
            </div>
          </>
        )}
        <details>
          <summary>{t('export.dependencies')}</summary>
          <p>{t('export.required', {version: MINIMUM_RUNTIME_VERSION})}</p>
          {plugins(w).map(p => (
            <p key={p}>
              {p} · {t(report?.plugins.find(x => x.name === p)?.found ? 'export.pluginFound' : 'export.pluginUnknown')}
            </p>
          ))}
          <HelpNote label={t('export.dependencies')}>{t('export.noPlugins')}</HelpNote>
        </details>
        <HelpNote label={tr('출력 구성')}>{t('export.safe')}</HelpNote>
        {problems.map(p => (
          <p key={p} className="error-status">
            {p}
          </p>
        ))}
        {notices.map(p => (
          <p key={p} className="warning-status">
            {p}
          </p>
        ))}
        {report?.warnings.map(s => (
          <p key={s} className="error-status">
            {s}
          </p>
        ))}
        {report?.runtime && <RuntimeStatus verdict={report.runtime} />}
      </div>
      <div className="package-footer">
        <p className="package-message" role="status">
          {message || t(report ? (report.ready ? 'export.ready' : 'export.notReady') : 'export.initial')}
        </p>
        <div className="top-actions">
          <button disabled={busy || !!problems.length} onClick={() => void probe()}>
            {t(busy ? 'export.busy' : 'export.inspect')}
          </button>
          <button
            className="primary"
            disabled={busy || !report?.ready || !!problems.length}
            onClick={() => void output()}
          >
            {t('export.output')}
          </button>
        </div>
      </div>
    </div>
  );
}
