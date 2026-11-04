import {useEffect, useRef, useState} from 'react';
import * as THREE from 'three';
import {HOME_CAMERA, orbitDelta, panScale, verticalFov, wheelFactor} from './cameraControls.ts';
import type {Ragdoll} from '../ragdoll.ts';
import {builtInRagdoll} from '../ragdoll.ts';
import type {RagdollData} from '../ragdollSim/data.ts';
import {loadRagdollData} from '../ragdollSim/load.ts';
import type {M4} from '../ragdollSim/math.ts';
import {mulV3, pos4, rot4, add, scale as scaleV} from '../ragdollSim/math.ts';
import type {RagdollScenario} from '../ragdollSim/preview.ts';
import {RagdollPreview, poseFromModel, simProfile} from '../ragdollSim/preview.ts';
import {HAVOK_SCALE, shapeCapsule} from '../ragdollSim/sim.ts';
import {tr} from '../i18n/korean.ts';
import {errorText} from '../errorText.ts';

// welded: a physics-off body below a simulated one, carried by the body above (RagdollSim.welded).
const COLORS = {simulated: 0x3fb8a8, held: 0x6a6a6a, welded: 0xa98bd6, anchor: 0xf0d79a, selected: 0x8fd3ff};
const scenarioNames = (): [RagdollScenario, string][] => [
  ['hold', tr('그대로')],
  ['walk', tr('걷기 → 정지')],
  ['run', tr('달리기 → 급정지')],
  ['turn', tr('제자리 회전')],
  ['jump', tr('점프')],
];

type Capsule = {body: string; mesh: any; a: [number, number, number]; b: [number, number, number]};

/** The carry's ragdoll simulation in the 3D view (docs/mockup-carry-ragdoll-sim, 11-04): the lift target's ragdoll
 *  held by the carrier's hand, moved by a scenario, with the card's values applied as they change. The calculator is
 *  src/ragdollSim (HKX_Edit's, ported). */
export function RagdollView({
  rig,
  ragdoll,
  anchor,
  poseWorlds,
  selected,
  select,
  anchorTo,
}: {
  rig: string;
  ragdoll: Ragdoll | null;
  /** The held body (the carry's grip point); '' = the first simulated-off body, else the rig's first body. */
  anchor: string;
  /** Model-space bone matrices of the start pose by name (the lift's fix frame), or the rest pose. */
  poseWorlds?: Map<string, M4>;
  selected: string;
  select: (bone: string) => void;
  anchorTo: (bone: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<{rig: string; rag: RagdollData} | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(true);
  const [scenario, setScenario] = useState<RagdollScenario>('walk');
  const [speed, setSpeed] = useState(1);
  const [actorScale, setActorScale] = useState(1);
  const [floor, setFloor] = useState(false);
  const [status, setStatus] = useState({time: 0, speed: 0, error: 0});
  const preview = useRef<RagdollPreview | null>(null);
  const pose = data && poseWorlds ? poseFromModel(data.rag, poseWorlds) : undefined;
  const poseKey = poseWorlds ? [...poseWorlds.keys()].length + ':' + [...poseWorlds.values()][0]?.join(',') : '';
  const live = useRef({select, anchorTo, selected, anchor});
  live.current = {select, anchorTo, selected, anchor};

  useEffect(() => {
    let alive = true;
    setError('');
    loadRagdollData(rig).then(
      rag => alive && setData({rig, rag}),
      e => alive && setError(tr('이 리그의 래그돌 데이터가 없습니다: ') + errorText(e))
    );
    return () => {
      alive = false;
    };
  }, [rig]);

  const heldBody = (rag: RagdollData) => {
    const named = rag.bodies.find(b => b.node.toLowerCase() === anchor.toLowerCase());
    if (named) return named.node;
    const values = ragdoll ?? builtInRagdoll(rig);
    const off = values.bodies.find(b => !b.simulate && rag.bodies.some(x => x.node === b.bone));
    return off?.bone ?? rag.bodies[0].node;
  };

  // The simulation: made when the rig data arrives; profile, anchor, pose, scale and floor update it.
  const profileKey = JSON.stringify(ragdoll);
  useEffect(() => {
    if (!data || data.rig !== rig) return;
    const p = preview.current;
    const profile = simProfile(ragdoll, rig, builtInRagdoll);
    if (!p || p.rag !== data.rag) {
      preview.current = new RagdollPreview(data.rag, {
        pose,
        scale: actorScale,
        anchor: heldBody(data.rag),
        profile,
        floor: floor ? 0 : null,
      });
      preview.current.setScenario(scenario, speed);
      preview.current.playing = playing;
      return;
    }
    p.setProfile(profile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, profileKey]);
  useEffect(() => {
    if (data) preview.current?.setAnchor(heldBody(data.rag));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor]);
  useEffect(() => {
    if (preview.current && data) preview.current.setPose(pose);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poseKey]);
  useEffect(() => preview.current?.setScale(actorScale), [actorScale]);
  useEffect(() => preview.current?.setFloor(floor ? 0 : null), [floor]);
  useEffect(() => {
    if (preview.current) preview.current.playing = playing;
  }, [playing]);
  useEffect(() => preview.current?.setScenario(scenario, speed), [scenario, speed]);

  // The scene: drawn every frame while the view is open.
  useEffect(() => {
    const element = host.current;
    if (!element || !data) return;
    let renderer: any;
    try {
      renderer = new THREE.WebGLRenderer({antialias: true});
    } catch (e) {
      setError(tr('WebGL을 초기화할 수 없습니다: ') + errorText(e));
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000),
      common = new THREE.Group(),
      target = new THREE.Vector3(0, 60, 0),
      // The camera looks at the carrier's hand and goes with it; Shift+middle drag moves it off the hand.
      panOffset = new THREE.Vector3(),
      spherical = {...HOME_CAMERA, distance: 300};
    common.rotation.x = -Math.PI / 2; // the game is Z-up
    scene.add(common);
    scene.background = new THREE.Color(0x212121);
    scene.add(new THREE.HemisphereLight(0xdce8ff, 0x26303b, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(180, 260, 140);
    scene.add(key);
    scene.add(new THREE.GridHelper(400, 20, 0x505050, 0x303030));
    const hand = new THREE.Mesh(
      new THREE.SphereGeometry(3, 16, 12),
      new THREE.MeshBasicMaterial({color: COLORS.anchor})
    );
    common.add(hand);
    const capsules: Capsule[] = [];
    for (const body of data.rag.bodies)
      for (const shape of body.shapes) {
        const [a, b, r] = shapeCapsule(shape);
        const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        const mesh = new THREE.Mesh(
          new THREE.CapsuleGeometry(r, Math.max(length, 0.001), 4, 12),
          new THREE.MeshStandardMaterial({color: COLORS.simulated, roughness: 0.6, metalness: 0.05})
        );
        mesh.userData.body = body.node;
        common.add(mesh);
        capsules.push({body: body.node, mesh, a, b});
      }
    const setCamera = () => {
      const cosPitch = Math.cos(spherical.pitch);
      camera.position.set(
        target.x + Math.sin(spherical.yaw) * cosPitch * spherical.distance,
        target.y + Math.sin(spherical.pitch) * spherical.distance,
        target.z + Math.cos(spherical.yaw) * cosPitch * spherical.distance
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(target);
      camera.fov = verticalFov(spherical.fov, camera.aspect);
      camera.updateProjectionMatrix();
    };
    const resize = () => {
      const w = Math.max(1, element.clientWidth),
        h = Math.max(1, element.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      setCamera();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    // Middle button turns, Shift+middle pans, the wheel zooms (the 3D view's controls); a click picks a body and a
    // double click makes it the held body.
    let drag: {x: number; y: number; pan: boolean} | null = null;
    const canvas = renderer.domElement;
    const pick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        ),
        camera
      );
      const hit = ray.intersectObjects(capsules.map(c => c.mesh))[0];
      return (hit?.object.userData.body as string | undefined) ?? '';
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 1) return;
      e.preventDefault();
      drag = {x: e.clientX, y: e.clientY, pan: e.shiftKey};
      canvas.setPointerCapture(e.pointerId);
    };
    const moveDrag = (e: PointerEvent) => {
      if (!drag) return;
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.pan) {
        const s = panScale(spherical.distance, spherical.fov, canvas.clientWidth);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0),
          up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        panOffset.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
      } else Object.assign(spherical, orbitDelta(spherical.yaw, spherical.pitch, dx, dy));
      setCamera();
    };
    const up = () => (drag = null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      spherical.distance = Math.min(5000, Math.max(20, spherical.distance * wheelFactor(e.deltaY, e.deltaMode)));
      setCamera();
    };
    const click = (e: MouseEvent) => {
      const body = pick(e);
      if (body) live.current.select(body);
    };
    const dblclick = (e: MouseEvent) => {
      const body = pick(e);
      if (body) live.current.anchorTo(body);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', moveDrag);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('wheel', wheel, {passive: false});
    canvas.addEventListener('click', click);
    canvas.addEventListener('dblclick', dblclick);
    const axis = new THREE.Vector3(0, 1, 0),
      dir = new THREE.Vector3();
    let last = performance.now(),
      shown = 0,
      raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const p = preview.current;
      if (!p || p.rag !== data.rag) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      p.advance(dt);
      const frames = p.sim.bodyFrames();
      const s = p.scale;
      for (const c of capsules) {
        const f = frames.get(c.body);
        if (!f) continue;
        const a = add(mulV3(rot4(f), scaleV(c.a, s)), pos4(f)),
          b = add(mulV3(rot4(f), scaleV(c.b, s)), pos4(f));
        c.mesh.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
        dir.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
        if (dir.lengthSq() > 1e-9) c.mesh.quaternion.setFromUnitVectors(axis, dir.normalize());
        c.mesh.scale.setScalar(s);
        const i = p.sim.body(c.body);
        const material = c.mesh.material as any;
        const color =
          c.body.toLowerCase() === live.current.selected.toLowerCase()
            ? COLORS.selected
            : c.body === p.anchor
              ? COLORS.anchor
              : p.sim.welded[i]
                ? COLORS.welded
                : p.sim.dynamic[i]
                  ? COLORS.simulated
                  : COLORS.held;
        if (material.color.getHex() !== color) material.color.setHex(color);
      }
      const h = pos4(p.hand);
      hand.position.set(h[0], h[1], h[2]);
      // Game (x, y, z) is (x, z, -y) in the Y-up scene.
      target.set(h[0], h[2], -h[1]).add(panOffset);
      setCamera();
      renderer.render(scene, camera);
      if (now - shown > 150) {
        shown = now;
        const v = p.handVelocity;
        setStatus({
          time: p.t,
          speed: Math.hypot(v[0], v[1], v[2]) / HAVOK_SCALE,
          error: p.sim.maxJointError,
        });
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', moveDrag);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('click', click);
      canvas.removeEventListener('dblclick', dblclick);
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
      renderer.dispose();
      canvas.remove();
    };
  }, [data]);

  const sim = preview.current?.sim;
  return (
    <div className="ragdoll-view">
      <div className="ragdoll-view-scene" ref={host}>
        {error && <div className="viewport-message">{error}</div>}
        <div className="ragdoll-view-legend">
          <span>
            <i style={{background: '#3fb8a8'}} />
            {tr('물리로 흔들림')}
          </span>
          <span>
            <i style={{background: '#6a6a6a'}} />
            {tr('자세를 따라감(물리 끔)')}
          </span>
          <span>
            <i style={{background: '#a98bd6'}} />
            {tr('위 몸체에 붙어 감(물리 끔)')}
          </span>
          <span>
            <i style={{background: '#f0d79a'}} />
            {tr('쥐는 곳')}
          </span>
          <span>
            <i style={{background: '#8fd3ff'}} />
            {tr('선택한 몸체')}
          </span>
        </div>
        <div className="ragdoll-view-hint">{tr('몸체 클릭 = 선택 · 더블클릭 = 쥐는 곳으로')}</div>
      </div>
      <div className="ragdoll-bar">
        <span className="ragdoll-group">
          <button
            type="button"
            className="ragdoll-icon primary"
            title={playing ? tr('정지') : tr('재생')}
            aria-label={playing ? tr('정지') : tr('재생')}
            onClick={() => setPlaying(!playing)}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            className="ragdoll-icon"
            title={tr('처음부터')}
            aria-label={tr('처음부터')}
            onClick={() => {
              preview.current?.rebuild();
              preview.current?.setScenario(scenario, speed);
            }}
          >
            ⟲
          </button>
        </span>
        <span className="ragdoll-group">
          <span className="ragdoll-label">{tr('움직임')}</span>
          <select
            aria-label={tr('움직임')}
            value={scenario}
            onChange={e => setScenario(e.target.value as RagdollScenario)}
          >
            {scenarioNames().map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <span className="ragdoll-num" title={tr('움직임 속도')}>
            <input
              type="number"
              aria-label={tr('움직임 속도')}
              min={0.1}
              max={3}
              step={0.1}
              value={speed}
              onChange={e =>
                Number.isFinite(Number(e.target.value)) && setSpeed(Math.min(3, Math.max(0.1, Number(e.target.value))))
              }
            />
            <span>×</span>
          </span>
        </span>
        <span className="ragdoll-group">
          <span className="ragdoll-label">{tr('크기')}</span>
          <span className="ragdoll-num">
            <input
              type="number"
              aria-label={tr('크기')}
              min={0.1}
              max={5}
              step={0.05}
              value={actorScale}
              onChange={e =>
                Number.isFinite(Number(e.target.value)) &&
                setActorScale(Math.min(5, Math.max(0.1, Number(e.target.value))))
              }
            />
            <span>×</span>
          </span>
          <label className="ragdoll-toggle">
            <input type="checkbox" checked={floor} onChange={e => setFloor(e.target.checked)} /> {tr('바닥 충돌')}
          </label>
        </span>
      </div>
      <div className="ragdoll-status">
        <span>
          <b>{status.time.toFixed(2)}</b> {tr('초')}
        </span>
        <span>
          {tr('운반자')} <b>{status.speed.toFixed(1)}</b> m/s
        </span>
        <span>{tr('몸체 {n} · 관절 {m} · 60 Hz', {n: sim?.names.length ?? 0, m: sim?.ja.length ?? 0})}</span>
        {pose ? <span>{tr('들기 자세에서 시작')}</span> : <span>{tr('기본 자세에서 시작')}</span>}
      </div>
    </div>
  );
}
