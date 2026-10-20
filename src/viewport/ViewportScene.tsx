import {HOME_CAMERA, orbitDelta, panScale, wheelFactor, verticalFov} from './cameraControls.ts';
import {createRenderGate} from './renderGate.ts';
import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {loadSkin} from './adapter.ts';
import {actorRootMatrix, boneSegments, matrixAt, multiplyRowMajor} from './matrices.ts';
import {applyActorPose, describeSkinJoints, validateSkinHierarchy} from './skin.ts';
import {safeLoaderUrl, validateGlbResources} from './glb.ts';
import type {ViewerData} from './types.ts';
import {firstPersonView} from './firstPersonCamera.ts';
import {tr} from '../i18n/korean.ts';

export type ActorView = 'me' | 'partner' | 'both';
export type ViewPreset = 'perspective' | 'front' | 'back' | 'left' | 'right' | 'top' | 'camera';
/** The first-person skeleton's camera bone (firstPersonCamera.ts). */
export const CAMERA_BONE = 'Camera1st [Cam1]';
/** About the game's default field of view (fDefaultWorldFOV; the wheel changes it). Skyrim measures
 *  FOV across a 4:3 screen and widens it on wider ones (the height stays): 70 is about 55 degrees tall. */
export const FIRST_PERSON_FOV = 70;
/** The camera preset looks through CAMERA_BONE of the first actor, when it has one. */
export const cameraBone = (data: ViewerData) => data.actors[0]?.bones.findIndex(b => b.name === CAMERA_BONE) ?? -1;
export type ViewOptions = {
  skeleton: boolean;
  skin: boolean;
  rootMotion: boolean;
  trajectory: boolean;
  actor: ActorView;
  preset: ViewPreset;
};

type ActorObjects = {root: any; lines: any; points: any; skins: {scene: any; meshes: any[]}[]};

const rowMatrix = (values: readonly number[]) => {
  const matrix = new THREE.Matrix4();
  matrix.set(...values);
  return matrix;
};

function disposeTree(root: any) {
  root?.traverse?.((object: any) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material))
        if (value && typeof value === 'object' && typeof (value as {dispose?: unknown}).dispose === 'function')
          (value as {dispose: () => void}).dispose();
      material.dispose?.();
    }
  });
}

export function ViewportScene({
  data,
  frame,
  options,
  skinPaths,
  onSceneError,
  onSkinStatus,
  cameraCommand,
}: {
  cameraCommand?: {serial: number; kind: 'fit' | 'home'};
  data: ViewerData;
  frame: number;
  options: ViewOptions;
  skinPaths: string[];
  onSceneError: (message: string) => void;
  onSkinStatus: (messages: string[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    frameRef = useRef(frame),
    optionsRef = useRef(options),
    invalidateRef = useRef(() => {}),
    commandRef = useRef((kind: 'fit' | 'home') => {});
  frameRef.current = frame;
  optionsRef.current = options;
  useEffect(() => invalidateRef.current(), [frame, options]);
  useEffect(() => {
    if (cameraCommand) commandRef.current(cameraCommand.kind);
  }, [cameraCommand]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    delete element.dataset.loadedSkins;
    delete element.dataset.skinMatchedBones;
    delete element.dataset.skinWorldError;
    let renderer: any,
      disposed = false;
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000),
      common = new THREE.Group(),
      actors: ActorObjects[] = [],
      target = new THREE.Vector3(),
      spherical = {...HOME_CAMERA},
      skinMessages: string[] = [],
      eye = cameraBone(data),
      // Looking around from the first-person camera: offsets from the bone's own direction.
      look = {yaw: 0, pitch: 0, fov: FIRST_PERSON_FOV};
    const through = () => optionsRef.current.preset === 'camera' && eye >= 0;
    common.rotation.x = -Math.PI / 2;
    scene.add(common);
    scene.background = new THREE.Color(0x212121);
    scene.add(new THREE.HemisphereLight(0xdce8ff, 0x26303b, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(180, 260, 140);
    scene.add(key);
    const grid = new THREE.GridHelper(400, 20, 0x505050, 0x303030);
    scene.add(grid);

    const setCamera = () => {
      if (through()) {
        const actor = data.actors[0],
          current = Math.max(0, Math.min(data.frameCount - 1, frameRef.current)),
          view = firstPersonView(
            multiplyRowMajor(
              actorRootMatrix(actor, current, optionsRef.current.rootMotion),
              matrixAt(actor, current, eye)
            ),
            look
          );
        camera.position.set(...view.position);
        camera.up.set(...view.up);
        camera.lookAt(
          view.position[0] + view.forward[0],
          view.position[1] + view.forward[1],
          view.position[2] + view.forward[2]
        );
        camera.fov = verticalFov(look.fov, 4 / 3);
        camera.updateProjectionMatrix();
        return;
      }
      camera.up.set(0, 1, 0);
      const cosPitch = Math.cos(spherical.pitch);
      camera.position.set(
        target.x + Math.sin(spherical.yaw) * cosPitch * spherical.distance,
        target.y + Math.sin(spherical.pitch) * spherical.distance,
        target.z + Math.cos(spherical.yaw) * cosPitch * spherical.distance
      );
      camera.lookAt(target);
      camera.fov = verticalFov(spherical.fov, camera.aspect);
      camera.updateProjectionMatrix();
    };
    const fit = () => {
      const box = new THREE.Box3();
      data.actors.forEach(actor =>
        actor.bones.forEach((_, bone) => {
          const matrix = matrixAt(actor, frameRef.current, bone);
          const point = new THREE.Vector3(matrix[3], matrix[7], matrix[11]).applyMatrix4(
            rowMatrix(actorRootMatrix(actor, frameRef.current, optionsRef.current.rootMotion))
          );
          box.expandByPoint(new THREE.Vector3(point.x, point.z, -point.y));
        })
      );
      if (box.isEmpty()) {
        target.set(0, 60, 0);
        spherical.distance = 260;
      } else {
        box.getCenter(target);
        const halfAngle = (Math.min(spherical.fov, verticalFov(spherical.fov, camera.aspect)) * Math.PI) / 360;
        spherical.distance = Math.max(30, (box.getSize(new THREE.Vector3()).length() * 0.575) / Math.sin(halfAngle));
      }
      setCamera();
    };

    try {
      if (import.meta.env.DEV && window.__AIE_P5_FORCE_WEBGL_ERROR__) throw new Error(tr('WebGL 초기화 강제 실패'));
      renderer = new THREE.WebGLRenderer({antialias: true, alpha: false, preserveDrawingBuffer: false});
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      element.appendChild(renderer.domElement);
    } catch (error) {
      disposeTree(scene);
      onSceneError(tr('WebGL을 초기화할 수 없습니다: ') + String(error));
      return;
    }

    data.actors.forEach((actor, actorIndex) => {
      const root = new THREE.Group(),
        lineGeometry = new THREE.BufferGeometry(),
        pointGeometry = new THREE.BufferGeometry(),
        color = actorIndex === 0 ? 0xffb454 : 0x55b8ff,
        lines = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({color, depthTest: false})),
        points = new THREE.Points(
          pointGeometry,
          new THREE.PointsMaterial({color, size: 4, sizeAttenuation: false, depthTest: false})
        );
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(boneSegments(actor, 0, true), 3));
      pointGeometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(
          actor.bones.flatMap((_, bone) => {
            const matrix = matrixAt(actor, 0, bone);
            return [matrix[3], matrix[7], matrix[11]];
          }),
          3
        )
      );
      lines.renderOrder = 4;
      points.renderOrder = 5;
      root.add(lines, points);
      common.add(root);
      actors.push({root, lines, points, skins: []});
      const trajectoryGeometry = new THREE.BufferGeometry();
      trajectoryGeometry.setAttribute('position', new THREE.Float32BufferAttribute(actor.trajectory.flat(), 3));
      const trajectory = new THREE.Line(
        trajectoryGeometry,
        new THREE.LineDashedMaterial({color, dashSize: 8, gapSize: 4, transparent: true, opacity: 0.85})
      );
      trajectory.computeLineDistances();
      trajectory.userData.trajectory = true;
      common.add(trajectory);
    });

    let lastFrame = -1,
      lastRoot = !options.rootMotion,
      lastSkeleton = !options.skeleton,
      lastTrajectory = !options.trajectory,
      lastSkin = !options.skin,
      lastActor = '' as ActorView | '',
      lastPreset = '' as ViewPreset | '';
    const update = () => {
      const currentFrame = Math.max(0, Math.min(data.frameCount - 1, frameRef.current)),
        current = optionsRef.current;
      if (lastPreset !== current.preset) {
        lastPreset = current.preset;
        if (current.preset === 'camera') Object.assign(look, {yaw: 0, pitch: 0});
        else if (current.preset === 'perspective') {
          spherical.yaw = HOME_CAMERA.yaw;
          spherical.pitch = HOME_CAMERA.pitch;
        } else {
          const positions: Record<Exclude<ViewPreset, 'perspective' | 'camera'>, [number, number]> = {
            front: [0, 0],
            back: [Math.PI, 0],
            left: [-Math.PI / 2, 0],
            right: [Math.PI / 2, 0],
            top: [0, Math.PI / 2 - 0.001],
          };
          [spherical.yaw, spherical.pitch] = positions[current.preset];
        }
        setCamera();
      }
      // The first-person camera moves with the clip.
      if (through() && (currentFrame !== lastFrame || current.rootMotion !== lastRoot)) setCamera();
      if (
        currentFrame !== lastFrame ||
        current.rootMotion !== lastRoot ||
        current.skeleton !== lastSkeleton ||
        current.trajectory !== lastTrajectory ||
        current.skin !== lastSkin ||
        current.actor !== lastActor
      ) {
        data.actors.forEach((actor, actorIndex) => {
          const object = actors[actorIndex],
            visible = current.actor === 'both' || (current.actor === 'me' ? actorIndex === 0 : actorIndex === 1),
            segments = boneSegments(actor, currentFrame, true),
            points = actor.bones.flatMap((_, bone) => {
              const matrix = matrixAt(actor, currentFrame, bone);
              return [matrix[3], matrix[7], matrix[11]];
            });
          object.root.visible = visible;
          object.lines.visible = current.skeleton;
          object.points.visible = current.skeleton;
          const linePositions = object.lines.geometry.getAttribute('position'),
            pointPositions = object.points.geometry.getAttribute('position');
          linePositions.array.set(segments);
          linePositions.needsUpdate = true;
          pointPositions.array.set(points);
          pointPositions.needsUpdate = true;
          const transform = actorRootMatrix(actor, currentFrame, current.rootMotion);
          object.root.matrixAutoUpdate = false;
          object.root.matrix.copy(rowMatrix(transform));
          object.root.matrixWorldNeedsUpdate = true;
          object.root.updateWorldMatrix(true, false);
          for (const skin of object.skins) {
            skin.scene.visible = current.skin;
            const stats = applyActorPose(object.root, actor, currentFrame, skin.meshes);
            element.dataset.skinMatchedBones = String(
              Math.max(Number(element.dataset.skinMatchedBones ?? 0), stats.matchedBones)
            );
            element.dataset.skinWorldError = String(
              Math.max(Number(element.dataset.skinWorldError ?? 0), stats.maxWorldError)
            );
          }
        });
        common.children
          .filter((object: any) => object.userData.trajectory)
          .forEach((object: any, index: number) => {
            object.visible =
              current.trajectory && (current.actor === 'both' || index === (current.actor === 'me' ? 0 : 1));
          });
        lastFrame = currentFrame;
        lastRoot = current.rootMotion;
        lastSkeleton = current.skeleton;
        lastTrajectory = current.trajectory;
        lastSkin = current.skin;
        lastActor = current.actor;
      }
    };

    const loadActorSkin = async (actorIndex: number, path: string) => {
      if (!path) return;
      try {
        const binary = await loadSkin(path);
        if (disposed) return;
        const bytes = Uint8Array.from(binary.bytes);
        validateGlbResources(bytes);
        await new Promise<void>((resolve, reject) => {
          const manager = new THREE.LoadingManager();
          manager.setURLModifier(safeLoaderUrl);
          manager.onError = (url: string) => reject(new Error(tr('GLB 리소스를 읽지 못했습니다: ') + url));
          new GLTFLoader(manager).parse(
            bytes.buffer,
            '',
            (gltf: any) => {
              try {
                if (disposed) {
                  disposeTree(gltf.scene);
                  resolve();
                  return;
                }
                const meshes: any[] = [];
                gltf.scene.traverse((object: any) => {
                  if (object.isSkinnedMesh) meshes.push(object);
                });
                if (!meshes.length) throw new Error(tr('GLB에 스킨드 메시가 없습니다.'));
                for (const mesh of meshes)
                  validateSkinHierarchy(describeSkinJoints(mesh.skeleton.bones), data.actors[actorIndex]);
                gltf.scene.name = 'skin-' + actorIndex;
                actors[actorIndex].root.add(gltf.scene);
                actors[actorIndex].skins.push({scene: gltf.scene, meshes});
                element.dataset.loadedSkins = String(actors.reduce((count, actor) => count + actor.skins.length, 0));
                lastFrame = -1;
                invalidateRef.current();
                resolve();
              } catch (error) {
                disposeTree(gltf.scene);
                reject(error);
              }
            },
            reject
          );
        });
      } catch (error) {
        if (disposed) return;
        skinMessages.push(tr('A{v0} 스킨: {v1}', {v0: actorIndex + 1, v1: String(error)}));
        onSkinStatus([...skinMessages]);
      }
    };
    skinPaths.slice(0, data.actors.length).forEach((path, index) => void loadActorSkin(index, path));

    const canvas = renderer.domElement,
      drag = {mode: '' as '' | 'orbit' | 'pan', x: 0, y: 0, pointer: -1};
    const down = (event: PointerEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
      drag.mode = event.shiftKey ? 'pan' : 'orbit';
      drag.pointer = event.pointerId;
      drag.x = event.clientX;
      drag.y = event.clientY;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!drag.mode || event.pointerId !== drag.pointer) return;
      drag.mode = event.shiftKey ? 'pan' : 'orbit';
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (through()) {
        // Looking around from the first-person camera (it does not move).
        look.yaw -= (dx * Math.PI) / 360;
        look.pitch = Math.max(-1.45, Math.min(1.45, look.pitch - (dy * Math.PI) / 360));
      } else if (drag.mode === 'orbit') {
        Object.assign(spherical, orbitDelta(spherical.yaw, spherical.pitch, dx, dy));
      } else {
        camera.updateMatrixWorld();
        const scale = panScale(spherical.distance, spherical.fov, element.clientWidth),
          right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0),
          up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        target.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
      }
      setCamera();
      invalidateRef.current();
    };
    const up = () => {
      drag.mode = '';
      if (drag.pointer >= 0 && canvas.hasPointerCapture(drag.pointer)) canvas.releasePointerCapture(drag.pointer);
      drag.pointer = -1;
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = wheelFactor(event.deltaY, event.deltaMode);
      if (through()) look.fov = Math.max(5, Math.min(150, look.fov * factor));
      else if (event.ctrlKey) spherical.fov = Math.max(5, Math.min(150, spherical.fov * factor));
      else spherical.distance = Math.max(1, Math.min(100000, spherical.distance * factor));
      setCamera();
      invalidateRef.current();
    };
    const context = (event: Event) => event.preventDefault();
    const lost = (event: Event) => {
      event.preventDefault();
      onSceneError(tr('WebGL 컨텍스트가 손실되었습니다. 뷰포트를 다시 여세요.'));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    window.addEventListener('blur', up);
    canvas.addEventListener('wheel', wheel, {passive: false});
    canvas.addEventListener('contextmenu', context);
    canvas.addEventListener('webglcontextlost', lost);
    const resize = () => {
      const width = element.clientWidth,
        height = element.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      setCamera();
      invalidateRef.current();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    fit();
    const render = () => {
      try {
        update();
        renderer.render(scene, camera);
      } catch (error) {
        onSceneError(tr('뷰포트 렌더링에 실패했습니다: ') + String(error));
        return;
      }
    };
    const gate = createRenderGate(requestAnimationFrame, cancelAnimationFrame, render);
    invalidateRef.current = gate.invalidate;
    commandRef.current = kind => {
      if (through()) {
        // Fit looks straight through the camera again; home also restores the field of view.
        Object.assign(look, kind === 'fit' ? {yaw: 0, pitch: 0} : {yaw: 0, pitch: 0, fov: FIRST_PERSON_FOV});
        setCamera();
      } else if (kind === 'fit') fit();
      else {
        Object.assign(spherical, HOME_CAMERA);
        target.set(0, 60, 0);
        setCamera();
      }
      gate.invalidate();
    };
    let inView = true;
    const visibility = () => {
      if (document.hidden || !inView) up();
      gate.setVisible(!document.hidden && inView);
    };
    const intersection = new IntersectionObserver(entries => {
      inView = entries[0]?.isIntersecting ?? false;
      visibility();
    });
    intersection.observe(element);
    document.addEventListener('visibilitychange', visibility);
    visibility();
    gate.invalidate();
    return () => {
      disposed = true;
      gate.dispose();
      invalidateRef.current = () => {};
      commandRef.current = () => {};
      document.removeEventListener('visibilitychange', visibility);
      observer.disconnect();
      intersection.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('lostpointercapture', up);
      window.removeEventListener('blur', up);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', context);
      canvas.removeEventListener('webglcontextlost', lost);
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss?.();
      canvas.remove();
      delete element.dataset.loadedSkins;
      delete element.dataset.skinMatchedBones;
      delete element.dataset.skinWorldError;
      onSkinStatus([]);
    };
  }, [data, skinPaths.join('|')]);

  return <div className="viewport-scene" ref={host} data-testid="viewport-scene" />;
}
