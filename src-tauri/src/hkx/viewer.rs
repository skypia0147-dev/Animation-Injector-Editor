// SPDX-License-Identifier: GPL-3.0-only
//
// Rust port of the read-only data pipeline in HKX_Viewer/hkx_serde.py and
// HKX_Viewer/model.py. The spline decoder is in spline.rs. HKX_Viewer is GPLv3;
// source provenance and the original HavokLib attribution are documented in
// src-tauri/assets/PORTING_SOURCE.md and HKX_VIEWER_LICENSE_GPL-3.0.txt.

use super::spline::SplineAnimation;
use havok_classes::{
    hkaAnimation, hkaAnimationBinding, hkaInterleavedUncompressedAnimation, hkaSplineCompressedAnimation, Classes,
};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
};

type Mat4 = [f64; 16]; // Row-major, matching HKX_Viewer's numpy matrices.

const FILE_LIMIT: u64 = 64 * 1024 * 1024;
const MATRIX_FLOAT_LIMIT: usize = 8_000_000;
const IPC_ESTIMATED_BYTE_LIMIT: usize = 160 * 1024 * 1024;
const ESTIMATED_JSON_BYTES_PER_FLOAT: usize = 16;
const CANDIDATE_LIMIT: usize = 128;
const CANDIDATE_BONE_LIMIT: usize = 50_000;

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ViewerRequest {
    pub path: String,
    #[serde(default)]
    pub skeletons: Vec<String>,
    #[serde(default)]
    pub candidates: Vec<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ViewerBone {
    pub name: String,
    pub parent: i32,
    pub body: bool,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ViewerActor {
    pub skeleton: String,
    pub skeleton_path: String,
    pub bones: Vec<ViewerBone>,
    /// Frame-major object-space matrices, 16 row-major floats per bone.
    pub matrices: Vec<f32>,
    /// Per-frame AMR display overlay after root-facing rotation.
    pub root_translation: Vec<[f32; 3]>,
    pub root_yaw: Vec<f32>,
    /// Root-bone positions with AMR overlay applied, one point per frame.
    pub trajectory: Vec<[f32; 3]>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ViewerAnnotation {
    pub time: f32,
    pub text: String,
    pub track: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ViewerData {
    pub duration: f32,
    pub fps: f32,
    pub frame_count: usize,
    pub paired: bool,
    pub actors: Vec<ViewerActor>,
    pub annotations: Vec<ViewerAnnotation>,
}

#[derive(Clone)]
struct RawAnnotation {
    time: f32,
    text: String,
    track: String,
}

#[derive(Clone)]
struct SkeletonData {
    label: String,
    path: String,
    names: Vec<String>,
    parents: Vec<i32>,
    rest_local: Vec<Mat4>,
}

enum AnimationSource<'a, 'data> {
    Spline(&'a hkaSplineCompressedAnimation<'data>),
    Interleaved(&'a hkaInterleavedUncompressedAnimation<'data>),
}

impl<'a, 'data> AnimationSource<'a, 'data> {
    fn parent(&self) -> &hkaAnimation<'data> {
        match self {
            Self::Spline(value) => &value.parent,
            Self::Interleaved(value) => &value.parent,
        }
    }

    fn frame_count(&self) -> Result<usize, String> {
        let count = match self {
            Self::Spline(value) => usize::try_from(value.m_numFrames).map_err(|_| "HKX 프레임 수가 음수입니다.")?,
            Self::Interleaved(value) => {
                let tracks = track_count(&value.parent)?;
                if value.m_transforms.len() % tracks != 0 {
                    return Err("interleaved 변환 배열이 트랙 수와 맞지 않습니다.".into());
                }
                value.m_transforms.len() / tracks
            }
        };
        if count == 0 || count > 100_000 {
            return Err("HKX 프레임 수가 유효하지 않습니다.".into());
        }
        Ok(count)
    }

    fn fps(&self, frames: usize) -> f64 {
        match self {
            Self::Spline(value) if value.m_frameDuration.is_finite() && value.m_frameDuration > 0.0 => {
                (1.0 / value.m_frameDuration as f64).round().max(1.0)
            }
            _ => {
                let duration = self.parent().m_duration as f64;
                if duration > 0.0 && frames > 1 {
                    ((frames - 1) as f64 / duration).round().max(1.0)
                } else {
                    30.0
                }
            }
        }
    }
}

enum TrackReader<'a, 'data> {
    Spline(SplineAnimation),
    Interleaved(&'a hkaInterleavedUncompressedAnimation<'data>),
}

impl TrackReader<'_, '_> {
    fn local_transform(&self, track: usize, frame: usize) -> Result<Mat4, String> {
        match self {
            Self::Spline(value) => {
                let (translation, rotation, scale) = value.local_transform(track, frame)?;
                Ok(compose(translation, rotation, scale))
            }
            Self::Interleaved(value) => {
                let tracks = track_count(&value.parent)?;
                let item = value
                    .m_transforms
                    .get(frame * tracks + track)
                    .ok_or("interleaved 변환 인덱스가 범위를 벗어났습니다.")?;
                Ok(compose(
                    [
                        item.transition.x as f64,
                        item.transition.y as f64,
                        item.transition.z as f64,
                    ],
                    [
                        item.quaternion.x as f64,
                        item.quaternion.y as f64,
                        item.quaternion.z as f64,
                        item.quaternion.scaler as f64,
                    ],
                    [item.scale.x as f64, item.scale.y as f64, item.scale.z as f64],
                ))
            }
        }
    }
}

fn track_count(animation: &hkaAnimation<'_>) -> Result<usize, String> {
    let count = usize::try_from(animation.m_numberOfTransformTracks).map_err(|_| "HKX 변환 트랙 수가 음수입니다.")?;
    if count == 0 || count > 4096 {
        return Err("HKX 변환 트랙 수가 유효하지 않습니다.".into());
    }
    Ok(count)
}

fn track_reader<'a, 'data>(source: &AnimationSource<'a, 'data>) -> Result<TrackReader<'a, 'data>, String> {
    match source {
        AnimationSource::Spline(value) => {
            let blocks = usize::try_from(value.m_numBlocks).map_err(|_| "HKX 스플라인 블록 수가 음수입니다.")?;
            if blocks != value.m_blockOffsets.len() {
                return Err("HKX 스플라인 블록 수와 오프셋 목록이 맞지 않습니다.".into());
            }
            Ok(TrackReader::Spline(SplineAnimation::new(
                &value.m_data,
                &value.m_blockOffsets,
                track_count(&value.parent)?,
                usize::try_from(value.parent.m_numberOfFloatTracks).map_err(|_| "HKX float 트랙 수가 음수입니다.")?,
                usize::try_from(value.m_numFrames).map_err(|_| "HKX 프레임 수가 음수입니다.")?,
                usize::try_from(value.m_maxFramesPerBlock).map_err(|_| "HKX 블록 프레임 수가 음수입니다.")?,
            )?))
        }
        AnimationSource::Interleaved(value) => Ok(TrackReader::Interleaved(value)),
    }
}

fn compose(translation: [f64; 3], [x, y, z, w]: [f64; 4], scale: [f64; 3]) -> Mat4 {
    let norm = w * w + x * x + y * y + z * z;
    let factor = if norm < 1e-12 { 0.0 } else { 2.0 / norm };
    let wx = factor * w * x;
    let wy = factor * w * y;
    let wz = factor * w * z;
    let xx = factor * x * x;
    let xy = factor * x * y;
    let xz = factor * x * z;
    let yy = factor * y * y;
    let yz = factor * y * z;
    let zz = factor * z * z;
    [
        (1.0 - yy - zz) * scale[0],
        (xy - wz) * scale[1],
        (xz + wy) * scale[2],
        translation[0],
        (xy + wz) * scale[0],
        (1.0 - xx - zz) * scale[1],
        (yz - wx) * scale[2],
        translation[1],
        (xz - wy) * scale[0],
        (yz + wx) * scale[1],
        (1.0 - xx - yy) * scale[2],
        translation[2],
        0.0,
        0.0,
        0.0,
        1.0,
    ]
}

fn identity() -> Mat4 {
    [
        1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
    ]
}

fn multiply(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut result = [0.0; 16];
    for row in 0..4 {
        for column in 0..4 {
            result[row * 4 + column] = (0..4).map(|k| a[row * 4 + k] * b[k * 4 + column]).sum();
        }
    }
    result
}

fn body_bone(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    let helper = [
        "weapon",
        "shield",
        "quiver",
        "magicnode",
        "magiceffect",
        "camera",
        "animobject",
        "looknode",
        "eyebone",
        "npceye",
        "torch",
        "bow",
        "sheath",
        "arrow",
    ]
    .iter()
    .any(|keyword| name.contains(keyword));
    !helper && !(name.contains("x_npc") && (name.contains("translate") || name.contains("rotate")))
}

fn validate_hkx_path(path: &str) -> Result<PathBuf, String> {
    let value = Path::new(path);
    if !value.is_absolute()
        || path.starts_with("\\\\")
        || path.contains("://")
        || !value.extension().is_some_and(|e| e.eq_ignore_ascii_case("hkx"))
    {
        return Err("로컬 HKX 절대 경로가 필요합니다.".into());
    }
    Ok(value.to_path_buf())
}

fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("파일이 아닙니다.".into());
    }
    if metadata.len() > FILE_LIMIT {
        return Err("HKX는 64 MB 이하여야 합니다.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(FILE_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("HKX는 64 MB 이하여야 합니다.".into());
    }
    Ok(bytes)
}

fn skeleton_label(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("skeleton")
        .to_ascii_lowercase();
    if stem == "skeleton" || stem.starts_with("skeleton_") || stem.starts_with("skeletonbeast") {
        let parent = path.parent();
        let actor = parent
            .filter(|value| {
                value
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case("character assets"))
            })
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|value| value.to_str());
        if let Some(actor) = actor {
            return actor.to_ascii_lowercase();
        }
    }
    stem.strip_suffix("_female").unwrap_or(&stem).to_owned()
}

fn load_skeleton(path: &str) -> Result<SkeletonData, String> {
    let (path, bytes) = if let Some(bytes) = super::builtin::bytes(path) {
        (PathBuf::from(path), bytes.to_vec())
    } else {
        let path = validate_hkx_path(path)?;
        let bytes = read_limited(&path)?;
        (path, bytes)
    };
    let classes: indexmap::IndexMap<usize, Classes<'_>> =
        serde_hkx::from_bytes(&bytes).map_err(|e| format!("스켈레톤 HKX 해석 실패: {e}"))?;
    let skeleton = classes.values().find_map(|class| match class {
        Classes::hkaSkeleton(value) => Some(value),
        _ => None,
    });
    let skeleton = skeleton.ok_or("선택한 HKX에 hkaSkeleton이 없습니다.")?;
    let count = skeleton.m_bones.len();
    if count == 0 || count > 2048 || skeleton.m_parentIndices.len() != count || skeleton.m_referencePose.len() != count
    {
        return Err("스켈레톤의 본·부모·referencePose 개수가 맞지 않습니다.".into());
    }
    let mut names = Vec::with_capacity(count);
    let mut parents = Vec::with_capacity(count);
    let mut rest_local = Vec::with_capacity(count);
    for index in 0..count {
        let parent = skeleton.m_parentIndices[index] as i32;
        if parent >= index as i32 || parent < -1 {
            return Err("스켈레톤 부모 순서가 유효하지 않습니다.".into());
        }
        let pose = &skeleton.m_referencePose[index];
        names.push(skeleton.m_bones[index].m_name.as_str().to_owned());
        parents.push(parent);
        rest_local.push(compose(
            [
                pose.transition.x as f64,
                pose.transition.y as f64,
                pose.transition.z as f64,
            ],
            [
                pose.quaternion.x as f64,
                pose.quaternion.y as f64,
                pose.quaternion.z as f64,
                pose.quaternion.scaler as f64,
            ],
            [pose.scale.x as f64, pose.scale.y as f64, pose.scale.z as f64],
        ));
    }
    Ok(SkeletonData {
        label: skeleton_label(&path),
        path: path.to_string_lossy().into_owned(),
        names,
        parents,
        rest_local,
    })
}

fn add_virtual_root(mut skeleton: SkeletonData) -> SkeletonData {
    skeleton.names.insert(0, "NPC".into());
    skeleton.parents = std::iter::once(-1)
        .chain(
            skeleton
                .parents
                .into_iter()
                .map(|parent| if parent < 0 { 0 } else { parent + 1 }),
        )
        .collect();
    skeleton.rest_local.insert(0, identity());
    skeleton
}

fn annotations(animation: &hkaAnimation<'_>) -> Vec<RawAnnotation> {
    let mut result = Vec::new();
    for track in &animation.m_annotationTracks {
        for item in &track.m_annotations {
            if item.m_time.is_finite() && item.m_time >= 0.0 {
                result.push(RawAnnotation {
                    time: item.m_time,
                    text: item.m_text.as_str().to_owned(),
                    track: track.m_trackName.as_str().to_owned(),
                });
            }
        }
    }
    result.sort_by(|a, b| a.time.total_cmp(&b.time));
    result
}

fn animation_source<'a, 'data>(
    classes: &'a indexmap::IndexMap<usize, Classes<'data>>,
) -> Option<AnimationSource<'a, 'data>> {
    classes.values().find_map(|class| match class {
        Classes::hkaSplineCompressedAnimation(value) => Some(AnimationSource::Spline(value)),
        Classes::hkaInterleavedUncompressedAnimation(value) => Some(AnimationSource::Interleaved(value)),
        _ => None,
    })
}

fn binding<'a, 'data>(
    classes: &'a indexmap::IndexMap<usize, Classes<'data>>,
) -> Option<&'a hkaAnimationBinding<'data>> {
    classes.values().find_map(|class| match class {
        Classes::hkaAnimationBinding(value) => Some(value),
        _ => None,
    })
}

fn compatible_track_bones(
    skeleton: &SkeletonData,
    tracks: usize,
    binding: Option<&hkaAnimationBinding<'_>>,
) -> Option<HashSet<String>> {
    let indices: Vec<usize> =
        if let Some(binding) = binding.filter(|value| !value.m_transformTrackToBoneIndices.is_empty()) {
            if binding.m_transformTrackToBoneIndices.len() != tracks {
                return None;
            }
            let mut result = Vec::with_capacity(tracks);
            for &index in &binding.m_transformTrackToBoneIndices {
                let index = usize::try_from(index).ok()?;
                if index >= skeleton.names.len() {
                    return None;
                }
                result.push(index);
            }
            result
        } else {
            if tracks > skeleton.names.len() {
                return None;
            }
            (0..tracks).collect()
        };
    Some(
        indices
            .into_iter()
            .map(|index| skeleton.names[index].to_ascii_lowercase())
            .collect(),
    )
}

fn signatures() -> HashMap<String, HashSet<String>> {
    let parsed: HashMap<String, Vec<String>> =
        serde_json::from_str(include_str!("../../assets/signatures.json")).unwrap_or_default();
    parsed
        .into_iter()
        .map(|(name, bones)| {
            (
                name.to_ascii_lowercase(),
                bones.into_iter().map(|bone| bone.to_ascii_lowercase()).collect(),
            )
        })
        .collect()
}

fn jaccard(left: &HashSet<String>, right: &HashSet<String>) -> f64 {
    let union = left.union(right).count();
    if union == 0 {
        0.0
    } else {
        left.intersection(right).count() as f64 / union as f64
    }
}

fn path_segments(path: &str) -> Vec<String> {
    path.replace('\\', "/")
        .split('/')
        .map(str::to_ascii_lowercase)
        .collect()
}

fn choose_ordinary(
    path: &str,
    explicit: Option<&str>,
    candidates: Vec<SkeletonData>,
    tracks: usize,
    bind: Option<&hkaAnimationBinding<'_>>,
) -> Result<SkeletonData, String> {
    let signature = signatures();
    if let Some(explicit) = explicit.filter(|path| !path.is_empty()) {
        let skeleton = load_skeleton(explicit)?;
        let track_bones = compatible_track_bones(&skeleton, tracks, bind)
            .ok_or("지정한 스켈레톤이 애니메이션 binding과 맞지 않습니다.")?;
        if let Some(expected) = signature.get(&skeleton.label) {
            if jaccard(&track_bones, expected) <= 0.3 {
                return Err("지정한 스켈레톤의 signature가 애니메이션과 일치하지 않습니다.".into());
            }
        }
        return Ok(skeleton);
    }
    let mut valid: Vec<(SkeletonData, HashSet<String>)> = candidates
        .into_iter()
        .filter_map(|skeleton| compatible_track_bones(&skeleton, tracks, bind).map(|bones| (skeleton, bones)))
        .collect();
    if valid.is_empty() {
        return Err("일치하는 스켈레톤을 찾지 못했습니다. 뷰포트의 프리뷰 자산에서 스켈레톤 HKX를 지정하세요.".into());
    }
    let segments = path_segments(path);
    if let Some(index) = valid.iter().position(|(skeleton, _)| {
        (skeleton.label == "character_1st" && segments.iter().any(|part| part.contains("1stperson")))
            || (skeleton.label != "character_1st" && segments.iter().any(|part| part == &skeleton.label))
    }) {
        return Ok(valid.swap_remove(index).0);
    }
    let mut scored: Vec<(f64, SkeletonData)> = valid
        .into_iter()
        .filter_map(|(skeleton, bones)| {
            signature
                .get(&skeleton.label)
                .map(|expected| (jaccard(&bones, expected), skeleton))
        })
        .filter(|(score, _)| *score > 0.3)
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    match scored.as_slice() {
        [(score, skeleton), ..] if scored.get(1).is_none_or(|next| score - next.0 > 1e-6) => Ok(skeleton.clone()),
        _ => Err("스켈레톤 signature가 없거나 결과가 모호합니다. 스켈레톤 HKX를 지정하세요.".into()),
    }
}

/// Whether a pair HKX's two actors face each other at its first frame (Some(true)), or face the same way, one
/// behind the other (Some(false)); None when the file is not a pair or its root tracks cannot be read. The engine
/// turns a pair's two to face each other at the start (reorientSupport); a pair played from behind must not be.
pub(crate) fn pair_start_facing(classes: &indexmap::IndexMap<usize, Classes<'_>>) -> Option<bool> {
    if binding(classes)?.m_originalSkeletonName.as_str() != "PairedRoot" {
        return None;
    }
    let source = animation_source(classes)?;
    let parent = source.parent();
    let names = animation_track_names(parent, track_count(parent).ok()?).ok()?;
    let reader = track_reader(&source).ok()?;
    let at = |track: &str| names.iter().position(|n| n == track);
    // Each actor's facing: its pair root track and, when present, its own root bone under it (+Y is forward).
    let forward = |root: &str, bone: &str| -> Option<[f64; 2]> {
        let mut m = reader.local_transform(at(root)?, 0).ok()?;
        if let Some(b) = at(bone) {
            m = multiply(&m, &reader.local_transform(b, 0).ok()?);
        }
        let (x, y) = (m[1], m[5]);
        let length = (x * x + y * y).sqrt();
        (length.is_finite() && length > 1e-6).then(|| [x / length, y / length])
    };
    let a = forward("NPC", "NPC Root [Root]")?;
    let b = forward("2_", "2_NPC Root [Root]")?;
    // Facing each other: the forward directions point against each other (more than 90 degrees apart).
    Some(a[0] * b[0] + a[1] * b[1] < 0.0)
}

fn pair_target(track: &str) -> Option<(usize, String)> {
    if track == "PairedRoot" {
        None
    } else if let Some(name) = track.strip_prefix("2_") {
        Some((1, if name.is_empty() { "NPC" } else { name }.to_owned()))
    } else {
        Some((0, track.to_owned()))
    }
}

fn pair_track_sets(names: &[String]) -> [HashSet<String>; 2] {
    let mut result = [HashSet::new(), HashSet::new()];
    for name in names {
        if let Some((actor, bone)) = pair_target(name) {
            result[actor].insert(bone.to_ascii_lowercase());
        }
    }
    result
}

fn pair_score(skeleton: &SkeletonData, target: &HashSet<String>) -> f64 {
    let mut bones: HashSet<String> = skeleton.names.iter().map(|name| name.to_ascii_lowercase()).collect();
    bones.insert("npc".into());
    if target.is_empty() {
        0.0
    } else {
        bones.intersection(target).count() as f64 / target.len() as f64
    }
}

fn choose_pair_actor(
    actor: usize,
    explicit: Option<&str>,
    candidates: &[SkeletonData],
    target: &HashSet<String>,
) -> Result<SkeletonData, String> {
    if let Some(explicit) = explicit.filter(|path| !path.is_empty()) {
        let skeleton = add_virtual_root(load_skeleton(explicit)?);
        if pair_score(&skeleton, target) <= 0.3 {
            return Err(format!(
                "지정한 A{} 스켈레톤의 본 이름이 페어 트랙과 맞지 않습니다.",
                actor + 1
            ));
        }
        return Ok(skeleton);
    }
    let mut scores: Vec<(f64, &SkeletonData)> = candidates
        .iter()
        .map(|skeleton| (pair_score(skeleton, target), skeleton))
        .filter(|(score, _)| *score > 0.3)
        .collect();
    scores.sort_by(|a, b| b.0.total_cmp(&a.0));
    if scores.is_empty() || scores.get(1).is_some_and(|next| scores[0].0 - next.0 <= 1e-6) {
        return Err(format!(
            "A{} 스켈레톤 매칭이 모호합니다. 스켈레톤 HKX를 지정하세요.",
            actor + 1
        ));
    }
    Ok(add_virtual_root(scores[0].1.clone()))
}

fn ordinary_mapping(
    skeleton: &SkeletonData,
    tracks: usize,
    bind: Option<&hkaAnimationBinding<'_>>,
) -> Result<Vec<Option<usize>>, String> {
    compatible_track_bones(skeleton, tracks, bind).ok_or("스켈레톤이 애니메이션 binding과 맞지 않습니다.")?;
    if let Some(binding) = bind.filter(|value| !value.m_transformTrackToBoneIndices.is_empty()) {
        binding
            .m_transformTrackToBoneIndices
            .iter()
            .map(|&index| {
                usize::try_from(index)
                    .map(Some)
                    .map_err(|_| "binding 본 인덱스가 음수입니다.".to_owned())
            })
            .collect()
    } else {
        Ok((0..tracks).map(Some).collect())
    }
}

fn pair_mapping(skeleton: &SkeletonData, track_names: &[String], actor: usize) -> Vec<Option<usize>> {
    let indices: HashMap<String, usize> = skeleton
        .names
        .iter()
        .enumerate()
        .map(|(index, name)| (name.to_ascii_lowercase(), index))
        .collect();
    track_names
        .iter()
        .map(|track| {
            pair_target(track).and_then(|(target, bone)| {
                (target == actor)
                    .then(|| indices.get(&bone.to_ascii_lowercase()).copied())
                    .flatten()
            })
        })
        .collect()
}

fn parse_numbers_after(text: &str, keyword: &str, count: usize) -> Option<Vec<f64>> {
    let folded = text.to_ascii_lowercase();
    let start = folded.find(keyword)? + keyword.len();
    let values: Vec<f64> = text[start..]
        .split_whitespace()
        .take(count)
        .map(str::parse)
        .collect::<Result<_, _>>()
        .ok()?;
    (values.len() == count && values.iter().all(|value| value.is_finite())).then_some(values)
}

fn root_keys(annotations: &[RawAnnotation], fps: f64) -> (BTreeMap<usize, [f64; 3]>, BTreeMap<usize, f64>) {
    let mut positions = BTreeMap::new();
    let mut rotations = BTreeMap::new();
    for annotation in annotations {
        let frame = (annotation.time as f64 * fps).round().max(0.0) as usize;
        if let Some(value) = parse_numbers_after(&annotation.text, "animmotion", 3) {
            positions.insert(frame, [value[0], value[1], value[2]]);
        }
        if let Some(value) = parse_numbers_after(&annotation.text, "animrotation", 1) {
            rotations.insert(frame, value[0]);
        }
    }
    (positions, rotations)
}

fn interpolate_scalar(keys: &BTreeMap<usize, f64>, frame: usize) -> f64 {
    if keys.is_empty() {
        return 0.0;
    }
    let lower = keys.range(..=frame).next_back();
    let upper = keys.range(frame..).next();
    match (lower, upper) {
        (Some((lf, value)), Some((uf, _))) if lf == uf => *value,
        (Some((lf, left)), Some((uf, right))) => {
            let amount = (frame - lf) as f64 / (uf - lf) as f64;
            left * (1.0 - amount) + right * amount
        }
        (Some((_, value)), None) | (None, Some((_, value))) => *value,
        (None, None) => 0.0,
    }
}

fn interpolate_position(keys: &BTreeMap<usize, [f64; 3]>, frame: usize) -> [f64; 3] {
    if keys.is_empty() {
        return [0.0; 3];
    }
    let lower = keys.range(..=frame).next_back();
    let upper = keys.range(frame..).next();
    match (lower, upper) {
        (Some((lf, value)), Some((uf, _))) if lf == uf => *value,
        (Some((lf, left)), Some((uf, right))) => {
            let amount = (frame - lf) as f64 / (uf - lf) as f64;
            std::array::from_fn(|axis| left[axis] * (1.0 - amount) + right[axis] * amount)
        }
        (Some((_, value)), None) | (None, Some((_, value))) => *value,
        (None, None) => [0.0; 3],
    }
}

fn build_actor(
    skeleton: SkeletonData,
    reader: &TrackReader<'_, '_>,
    mapping: &[Option<usize>],
    frames: usize,
    fps: f64,
    annotations: &[RawAnnotation],
) -> Result<ViewerActor, String> {
    let float_count = frames
        .checked_mul(skeleton.names.len())
        .and_then(|value| value.checked_mul(16))
        .ok_or("본 행렬 크기가 넘쳤습니다.")?;
    if float_count > MATRIX_FLOAT_LIMIT {
        return Err("HKX 프레임 행렬이 메모리 제한을 넘습니다.".into());
    }
    let mut matrices = Vec::with_capacity(float_count);
    let mut root_positions = Vec::with_capacity(frames);
    let mut frame_local = skeleton.rest_local.clone();
    let mut frame_object = vec![identity(); skeleton.names.len()];
    let mut root0 = None;
    for frame in 0..frames {
        frame_local.clone_from(&skeleton.rest_local);
        for (track, bone) in mapping.iter().enumerate() {
            if let Some(bone) = *bone {
                frame_local[bone] = reader.local_transform(track, frame)?;
            }
        }
        for bone in 0..skeleton.names.len() {
            frame_object[bone] = if skeleton.parents[bone] < 0 {
                frame_local[bone]
            } else {
                multiply(&frame_object[skeleton.parents[bone] as usize], &frame_local[bone])
            };
            for value in frame_object[bone] {
                let value = value as f32;
                if !value.is_finite() {
                    return Err("HKX 본 행렬에 유한하지 않은 값이 있습니다.".into());
                }
                matrices.push(value);
            }
        }
        root0.get_or_insert(frame_object[0]);
        root_positions.push([frame_object[0][3], frame_object[0][7], frame_object[0][11]]);
    }
    let root0 = root0.ok_or("루트 본 행렬이 없습니다.")?;
    let (position_keys, rotation_keys) = root_keys(annotations, fps);
    let mut root_translation = Vec::with_capacity(frames);
    let mut root_yaw = Vec::with_capacity(frames);
    let mut trajectory = Vec::with_capacity(frames);
    for (frame, root) in root_positions.iter().copied().enumerate() {
        let local = interpolate_position(&position_keys, frame);
        let translated = [
            root0[0] * local[0] + root0[1] * local[1] + root0[2] * local[2],
            root0[4] * local[0] + root0[5] * local[1] + root0[6] * local[2],
            root0[8] * local[0] + root0[9] * local[1] + root0[10] * local[2],
        ];
        let yaw = interpolate_scalar(&rotation_keys, frame);
        let radians = yaw.to_radians();
        let (sine, cosine) = radians.sin_cos();
        let translated_f32 = translated.map(|value| value as f32);
        let yaw_f32 = yaw as f32;
        let point = [
            (cosine * root[0] - sine * root[1] + translated[0]) as f32,
            (sine * root[0] + cosine * root[1] + translated[1]) as f32,
            (root[2] + translated[2]) as f32,
        ];
        if !translated_f32.iter().all(|value| value.is_finite())
            || !yaw_f32.is_finite()
            || !point.iter().all(|value| value.is_finite())
        {
            return Err("HKX 루트 모션에 유한하지 않은 값이 있습니다.".into());
        }
        root_translation.push(translated_f32);
        root_yaw.push(yaw_f32);
        trajectory.push(point);
    }
    let bones = skeleton
        .names
        .iter()
        .enumerate()
        .map(|(index, name)| ViewerBone {
            name: name.clone(),
            parent: skeleton.parents[index],
            body: body_bone(name),
        })
        .collect();
    Ok(ViewerActor {
        skeleton: skeleton.label,
        skeleton_path: skeleton.path,
        bones,
        matrices,
        root_translation,
        root_yaw,
        trajectory,
    })
}

fn animation_track_names(animation: &hkaAnimation<'_>, tracks: usize) -> Result<Vec<String>, String> {
    if animation.m_annotationTracks.len() < tracks {
        return Err("페어 HKX의 annotation track 이름이 변환 트랙 수보다 적습니다.".into());
    }
    Ok(animation.m_annotationTracks[..tracks]
        .iter()
        .map(|track| track.m_trackName.as_str().to_owned())
        .collect())
}

fn candidate_paths(path: &Path, supplied: &[String]) -> Result<Vec<String>, String> {
    if supplied.len() > CANDIDATE_LIMIT {
        return Err("스켈레톤 후보는 한 번에 128개까지 지정할 수 있습니다.".into());
    }
    let mut result = supplied.to_vec();
    let mut cursor = path.parent();
    let mut actor_root = None;
    while let Some(directory) = cursor {
        if directory
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case("actors"))
        {
            actor_root = Some(directory.to_path_buf());
            break;
        }
        cursor = directory.parent();
    }
    if let Some(root) = actor_root {
        let mut pending = vec![(root, 0_usize)];
        let mut visited = 0_usize;
        while let Some((directory, depth)) = pending.pop() {
            if depth > 8 || visited > 8192 || result.len() >= CANDIDATE_LIMIT {
                continue;
            }
            visited += 1;
            let Ok(entries) = fs::read_dir(directory) else {
                continue;
            };
            for entry in entries.flatten() {
                let Ok(kind) = entry.file_type() else {
                    continue;
                };
                let entry_path = entry.path();
                if kind.is_dir() && !kind.is_symlink() {
                    pending.push((entry_path, depth + 1));
                } else if kind.is_file()
                    && entry_path.extension().is_some_and(|e| e.eq_ignore_ascii_case("hkx"))
                    && entry_path
                        .file_stem()
                        .and_then(|value| value.to_str())
                        .is_some_and(|value| value.to_ascii_lowercase().starts_with("skeleton"))
                    && result.len() < CANDIDATE_LIMIT
                {
                    result.push(entry_path.to_string_lossy().into_owned());
                }
            }
        }
    }
    let mut seen = HashSet::new();
    result.retain(|item| seen.insert(item.to_ascii_lowercase()));
    Ok(result)
}

fn load_candidates(paths: Vec<String>, excluded: &[String]) -> Result<Vec<SkeletonData>, String> {
    let excluded: HashSet<String> = excluded.iter().map(|path| path.to_ascii_lowercase()).collect();
    let mut result = Vec::new();
    let mut total_bones = 0_usize;
    for path in paths
        .into_iter()
        .filter(|path| !path.is_empty() && !excluded.contains(&path.to_ascii_lowercase()))
    {
        let Ok(skeleton) = load_skeleton(&path) else {
            continue;
        };
        total_bones = total_bones
            .checked_add(skeleton.names.len())
            .ok_or("스켈레톤 후보 본 총량이 넘쳤습니다.")?;
        if total_bones > CANDIDATE_BONE_LIMIT {
            return Err("스켈레톤 후보 본 총량이 메모리 제한을 넘습니다.".into());
        }
        result.push(skeleton);
    }
    Ok(result)
}

fn ensure_ipc_budget(frames: usize, skeletons: &[&SkeletonData], annotations: &[RawAnnotation]) -> Result<(), String> {
    let bones = skeletons.iter().try_fold(0_usize, |total, skeleton| {
        total
            .checked_add(skeleton.names.len())
            .ok_or("HKX 본 총량이 넘쳤습니다.")
    })?;
    let matrix_floats = frames
        .checked_mul(bones)
        .and_then(|value| value.checked_mul(16))
        .ok_or("HKX 프레임×본 행렬 총량이 넘쳤습니다.")?;
    if matrix_floats > MATRIX_FLOAT_LIMIT {
        return Err("HKX 전체 프레임×본 행렬이 IPC 메모리 제한을 넘습니다.".into());
    }
    let overlay_floats = frames
        .checked_mul(skeletons.len())
        .and_then(|value| value.checked_mul(7))
        .ok_or("HKX 루트 모션 IPC 총량이 넘쳤습니다.")?;
    let numeric_bytes = matrix_floats
        .checked_add(overlay_floats)
        .and_then(|value| value.checked_mul(ESTIMATED_JSON_BYTES_PER_FLOAT))
        .ok_or("HKX IPC byte 예산 계산이 넘쳤습니다.")?;
    let string_bytes = skeletons
        .iter()
        .flat_map(|skeleton| skeleton.names.iter())
        .map(String::len)
        .chain(
            annotations
                .iter()
                .map(|annotation| annotation.text.len() + annotation.track.len()),
        )
        .try_fold(0_usize, |total, length| total.checked_add(length))
        .ok_or("HKX IPC 문자열 byte 예산 계산이 넘쳤습니다.")?;
    if numeric_bytes
        .checked_add(string_bytes)
        .is_none_or(|bytes| bytes > IPC_ESTIMATED_BYTE_LIMIT)
    {
        return Err("HKX 프레임 IPC 응답이 160 MB 추정 제한을 넘습니다.".into());
    }
    Ok(())
}

fn decode(request: &ViewerRequest, bytes: &[u8]) -> Result<ViewerData, String> {
    if request.skeletons.len() > 2 {
        return Err("스켈레톤은 A1/A2 두 경로까지만 지정할 수 있습니다.".into());
    }
    let classes: indexmap::IndexMap<usize, Classes<'_>> =
        serde_hkx::from_bytes(bytes).map_err(|e| format!("HKX 해석 실패: {e}"))?;
    let source = animation_source(&classes).ok_or("지원되는 spline/interleaved 애니메이션이 없습니다.")?;
    let parent = source.parent();
    if !parent.m_duration.is_finite() || parent.m_duration <= 0.0 || parent.m_duration > 86_400.0 {
        return Err("HKX 애니메이션 길이가 유효하지 않습니다.".into());
    }
    let tracks = track_count(parent)?;
    let frames = source.frame_count()?;
    let fps = source.fps(frames);
    let paired = binding(&classes).is_some_and(|value| value.m_originalSkeletonName.as_str() == "PairedRoot");
    let raw_annotations = annotations(parent);
    let reader = track_reader(&source)?;
    let path = validate_hkx_path(&request.path)?;
    let paths = candidate_paths(&path, &request.candidates)?;
    // A built-in skeleton the front end names is left out when this build has none (a source build without the
    // preview assets): the actor is then matched from the candidates like any unset one.
    let skeletons: Vec<String> = request
        .skeletons
        .iter()
        .map(|path| {
            if path.starts_with("builtin/") && super::builtin::bytes(path).is_none() {
                String::new()
            } else {
                path.clone()
            }
        })
        .collect();
    let mut loaded = load_candidates(paths, &skeletons)?;
    // Prefer registered/local candidates. Add one canonical built-in per actor family.
    for (name, _) in super::builtin::FILES
        .iter()
        .filter(|(name, _)| name.starts_with("builtin/skeletons/"))
    {
        let stem = Path::new(name).file_stem().unwrap().to_string_lossy();
        if super::builtin::bytes(&format!("builtin/meshes/{stem}.glb")).is_none() {
            continue;
        }
        let skeleton = load_skeleton(name)?;
        if !loaded.iter().any(|item| item.label == skeleton.label) {
            loaded.push(skeleton);
        }
    }
    let actors = if paired {
        let names = animation_track_names(parent, tracks)?;
        let targets = pair_track_sets(&names);
        let first = choose_pair_actor(0, skeletons.first().map(String::as_str), &loaded, &targets[0])?;
        let second = choose_pair_actor(1, skeletons.get(1).map(String::as_str), &loaded, &targets[1])?;
        ensure_ipc_budget(frames, &[&first, &second], &raw_annotations)?;
        let first_annotations: Vec<_> = raw_annotations
            .iter()
            .filter(|annotation| !annotation.track.starts_with("2_"))
            .cloned()
            .collect();
        let second_annotations: Vec<_> = raw_annotations
            .iter()
            .filter(|annotation| annotation.track.starts_with("2_"))
            .cloned()
            .collect();
        vec![
            build_actor(
                first.clone(),
                &reader,
                &pair_mapping(&first, &names, 0),
                frames,
                fps,
                &first_annotations,
            )?,
            build_actor(
                second.clone(),
                &reader,
                &pair_mapping(&second, &names, 1),
                frames,
                fps,
                &second_annotations,
            )?,
        ]
    } else {
        let selected = choose_ordinary(
            &request.path,
            skeletons.first().map(String::as_str),
            loaded,
            tracks,
            binding(&classes),
        )?;
        let mapping = ordinary_mapping(&selected, tracks, binding(&classes))?;
        ensure_ipc_budget(frames, &[&selected], &raw_annotations)?;
        vec![build_actor(selected, &reader, &mapping, frames, fps, &raw_annotations)?]
    };
    Ok(ViewerData {
        duration: parent.m_duration,
        fps: fps as f32,
        frame_count: frames,
        paired,
        actors,
        annotations: raw_annotations
            .into_iter()
            .map(|annotation| ViewerAnnotation {
                time: annotation.time,
                text: annotation.text,
                track: annotation.track,
            })
            .collect(),
    })
}

pub fn read(request: &ViewerRequest) -> Result<ViewerData, String> {
    let path = validate_hkx_path(&request.path)?;
    let bytes = read_limited(&path)?;
    std::panic::catch_unwind(|| decode(request, &bytes))
        .map_err(|_| "HKX 프레임 해석 중 오류가 발생했습니다.".to_owned())?
}

/// Everything but the matrices, which follow the JSON header as f32 LE in actor order.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ActorHeader<'a> {
    skeleton: &'a str,
    skeleton_path: &'a str,
    bones: &'a [ViewerBone],
    matrix_count: usize,
    root_translation: &'a [[f32; 3]],
    root_yaw: &'a [f32],
    trajectory: &'a [[f32; 3]],
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FramesHeader<'a> {
    duration: f32,
    fps: f32,
    frame_count: usize,
    paired: bool,
    actors: Vec<ActorHeader<'a>>,
    annotations: &'a [ViewerAnnotation],
}

/// Frames for the WebView: up to 8 M floats would be ~70 MB of JSON numbers; raw f32 is 4 bytes each.
pub fn encode(data: &ViewerData) -> Result<Vec<u8>, String> {
    let header = FramesHeader {
        duration: data.duration,
        fps: data.fps,
        frame_count: data.frame_count,
        paired: data.paired,
        annotations: &data.annotations,
        actors: data
            .actors
            .iter()
            .map(|a| ActorHeader {
                skeleton: &a.skeleton,
                skeleton_path: &a.skeleton_path,
                bones: &a.bones,
                matrix_count: a.matrices.len(),
                root_translation: &a.root_translation,
                root_yaw: &a.root_yaw,
                trajectory: &a.trajectory,
            })
            .collect(),
    };
    let floats: usize = data.actors.iter().map(|a| a.matrices.len()).sum();
    crate::ipc_binary::frame(&header, floats * 4, |out| {
        for actor in &data.actors {
            for value in &actor.matrices {
                out.extend_from_slice(&value.to_le_bytes());
            }
        }
    })
}

#[tauri::command]
pub async fn hkx_frames(request: ViewerRequest) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || read(&request).and_then(|data| encode(&data)))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Grapple's pairs (a local mod, AIE_GRAPPLE_HKX_DIR, so ignored by default): the four played from behind are the
    // only ones whose two actors face the same way at the first frame; their XML keeps reorientSupport="false".
    #[test]
    #[ignore]
    fn grapple_pairs_from_behind_face_the_same_way() {
        let dir = std::env::var("AIE_GRAPPLE_HKX_DIR").expect("AIE_GRAPPLE_HKX_DIR: the folder holding Grapple's HKX");
        for (name, front) in [
            ("Grapple_Crimson_Attack_F_Front", true),
            ("Grapple_Crimson_Attack_F_Back", true),
            ("Grapple_Crimson_Attack_B_Back", false),
            ("Grapple_Crimson_Giant_Swing", true),
            ("Grapple_Crimson_Pounding", true),
            ("Grapple_Crimson_RKO", true),
            ("Grapple_Crimson_Suplex", false),
            ("Grapple_Air_Front", true),
            ("Grapple_AirKill_Front", true),
            ("Grapple_ForHonor_Front", true),
            ("Grapple_Crimson_Fail", true),
            ("Grapple_Air_Back", false),
            ("Grapple_AirKill_Back", false),
            ("Grapple_Lift", true),
        ] {
            let bytes = std::fs::read(format!(r"{dir}\{name}.hkx")).unwrap();
            let classes: indexmap::IndexMap<usize, Classes<'_>> = serde_hkx::from_bytes(&bytes).unwrap();
            assert_eq!(pair_start_facing(&classes), Some(front), "{name}");
        }
    }

    fn compare_float(maximum: &mut f32, label: &str, actual: f32, expected: f32) {
        assert!(actual.is_finite(), "actual {label} is not finite: {actual}");
        assert!(expected.is_finite(), "expected {label} is not finite: {expected}");
        *maximum = maximum.max((actual - expected).abs());
    }

    #[test]
    fn matrix_compose_and_pair_routes_match_viewer_conventions() {
        assert_eq!(compose([1.0, 2.0, 3.0], [0.0, 0.0, 0.0, 1.0], [1.0; 3])[3], 1.0);
        assert_eq!(pair_target("NPC"), Some((0, "NPC".into())));
        assert_eq!(pair_target("2_"), Some((1, "NPC".into())));
        assert_eq!(
            pair_target("2_NPC Pelvis [Pelv]"),
            Some((1, "NPC Pelvis [Pelv]".into()))
        );
        assert_eq!(pair_target("PairedRoot"), None);
    }

    #[test]
    fn root_motion_parser_accepts_pair_prefixes() {
        let values = parse_numbers_after("2_animmotion -1.5 2 3", "animmotion", 3).unwrap();
        assert_eq!(values, vec![-1.5, 2.0, 3.0]);
        assert_eq!(
            parse_numbers_after("NPCanimrotation 180", "animrotation", 1),
            Some(vec![180.0])
        );
    }

    #[test]
    fn bundled_skeletons_are_valid() {
        for (path, _) in super::super::builtin::FILES.iter().filter(|(p, _)| p.ends_with(".hkx")) {
            assert!(!load_skeleton(path).unwrap().names.is_empty(), "{path}");
        }
    }

    #[test]
    #[ignore]
    fn native_builtin_preview() {
        let path = std::env::var("AIE_VIEWER_HKX").unwrap();
        let result = read(&ViewerRequest {
            path,
            skeletons: vec![],
            candidates: vec![],
        })
        .unwrap();
        assert!(!result.actors.is_empty());
        for actor in &result.actors {
            assert!(actor.skeleton_path.starts_with("builtin/"));
            assert!(super::super::builtin::bytes(&format!("builtin/meshes/{}.glb", actor.skeleton)).is_some());
        }
        if let Ok(path) = std::env::var("AIE_VIEWER_ACTUAL_OUTPUT") {
            fs::write(path, serde_json::to_vec(&result).unwrap()).unwrap();
        }
        eprintln!(
            "Built-in preview: paired={} actors={:?}",
            result.paired,
            result.actors.iter().map(|a| &a.skeleton).collect::<Vec<_>>()
        );
    }

    #[test]
    fn binary_frames_round_trip_to_the_same_viewer_data() {
        let actor = |seed: f32| ViewerActor {
            skeleton: "character".into(),
            skeleton_path: "builtin/skeletons/character.hkx".into(),
            bones: vec![
                ViewerBone {
                    name: "NPC Root [Root]".into(),
                    parent: -1,
                    body: true,
                },
                ViewerBone {
                    name: "뼈".into(),
                    parent: 0,
                    body: false,
                },
            ],
            matrices: (0..2 * 2 * 16).map(|i| seed + i as f32 * 0.125 - 1.0e-7).collect(),
            root_translation: vec![[1.0, 2.0, 3.0], [4.0, 5.0, 6.5]],
            root_yaw: vec![0.0, 90.25],
            trajectory: vec![[0.0, 1.0, 2.0], [3.0, 4.0, 5.0]],
        };
        let data = ViewerData {
            duration: 1.5,
            fps: 30.0,
            frame_count: 2,
            paired: true,
            actors: vec![actor(0.5), actor(-3.0)],
            annotations: vec![ViewerAnnotation {
                time: 0.25,
                text: "HitFrame".into(),
                track: "".into(),
            }],
        };
        let bytes = encode(&data).unwrap();
        let (mut header, payload) = crate::ipc_binary::split(&bytes);
        let mut floats = payload
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()));
        for actor in header["actors"].as_array_mut().unwrap() {
            let count = actor
                .as_object_mut()
                .unwrap()
                .remove("matrixCount")
                .unwrap()
                .as_u64()
                .unwrap() as usize;
            actor["matrices"] = serde_json::json!(floats.by_ref().take(count).collect::<Vec<f32>>());
        }
        assert!(floats.next().is_none());
        let decoded: ViewerData = serde_json::from_value(header).unwrap();
        assert_eq!(
            serde_json::to_value(&decoded).unwrap(),
            serde_json::to_value(&data).unwrap()
        );
        for (a, b) in decoded.actors.iter().zip(&data.actors) {
            assert!(a
                .matrices
                .iter()
                .zip(&b.matrices)
                .all(|(x, y)| x.to_bits() == y.to_bits()));
        }
    }

    /// Stage 3 measurement: AIE_VIEWER_HKX=<clip> cargo test --release measure_frame_encoding -- --ignored --nocapture
    #[test]
    #[ignore]
    fn measure_frame_encoding() {
        let path = std::env::var("AIE_VIEWER_HKX").expect("set AIE_VIEWER_HKX");
        let data = read(&ViewerRequest {
            path,
            skeletons: vec![],
            candidates: vec![],
        })
        .unwrap();
        let time = |f: &dyn Fn() -> usize| {
            let mut ms: Vec<f64> = (0..9)
                .map(|_| {
                    let t = std::time::Instant::now();
                    std::hint::black_box(f());
                    t.elapsed().as_secs_f64() * 1e3
                })
                .collect();
            ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
            (ms[4], f())
        };
        let (json_ms, json_bytes) = time(&|| serde_json::to_vec(&data).unwrap().len());
        let (binary_ms, binary_bytes) = time(&|| encode(&data).unwrap().len());
        if let Ok(out) = std::env::var("AIE_VIEWER_BINARY_OUTPUT") {
            fs::write(out, encode(&data).unwrap()).unwrap();
        }
        eprintln!(
            "frames={} json={json_bytes}B {json_ms:.1}ms binary={binary_bytes}B {binary_ms:.1}ms",
            data.frame_count
        );
    }

    #[test]
    fn rejects_invalid_animation_paths() {
        let request = ViewerRequest {
            path: "https://example.org/a.hkx".into(),
            skeletons: vec![],
            candidates: vec![],
        };
        assert!(read(&request).is_err());
    }

    #[test]
    fn rejects_pair_aggregate_ipc_budget() {
        let skeleton = SkeletonData {
            label: "budget".into(),
            path: "C:\\budget.hkx".into(),
            names: (0..1000).map(|index| format!("bone{index}")).collect(),
            parents: std::iter::once(-1).chain(0..999).collect(),
            rest_local: vec![identity(); 1000],
        };
        assert!(ensure_ipc_budget(300, &[&skeleton], &[]).is_ok());
        assert!(ensure_ipc_budget(300, &[&skeleton, &skeleton], &[]).is_err());
    }

    #[test]
    fn rejects_malformed_local_hkx() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target")
            .join("p5-malformed.hkx");
        fs::write(&path, [0_u8; 64]).unwrap();
        let request = ViewerRequest {
            path: path.to_string_lossy().into_owned(),
            skeletons: vec![],
            candidates: vec![],
        };
        assert!(read(&request).is_err());
        fs::remove_file(path).unwrap();
    }

    #[test]
    #[ignore]
    fn rejects_real_mismatched_skeleton() {
        let request = ViewerRequest {
            path: std::env::var("AIE_VIEWER_HKX").expect("set AIE_VIEWER_HKX"),
            skeletons: vec![std::env::var("AIE_VIEWER_BAD_SKELETON").expect("set AIE_VIEWER_BAD_SKELETON")],
            candidates: vec![],
        };
        let error = read(&request).expect_err("mismatched skeleton must be rejected");
        assert!(error.contains("맞지 않") || error.contains("일치하지 않"), "{error}");
    }

    #[test]
    #[ignore]
    fn native_frames_match_python_reference() {
        let request = ViewerRequest {
            path: std::env::var("AIE_VIEWER_HKX").expect("set AIE_VIEWER_HKX"),
            skeletons: std::env::var("AIE_VIEWER_SKELETONS")
                .expect("set AIE_VIEWER_SKELETONS")
                .split(';')
                .map(str::to_owned)
                .collect(),
            candidates: vec![],
        };
        let expected_path = std::env::var("AIE_VIEWER_EXPECTED").expect("set AIE_VIEWER_EXPECTED");
        let expected: ViewerData = serde_json::from_slice(&fs::read(expected_path).unwrap()).unwrap();
        let started = std::time::Instant::now();
        let actual = read(&request).unwrap();
        let elapsed = started.elapsed();
        let encoded = serde_json::to_vec(&actual).unwrap();
        if let Ok(output) = std::env::var("AIE_VIEWER_ACTUAL_OUTPUT") {
            let output = Path::new(&output);
            if let Some(parent) = output.parent() {
                fs::create_dir_all(parent).unwrap();
            }
            fs::write(output, &encoded).unwrap();
        }
        assert!(actual.duration.is_finite() && expected.duration.is_finite());
        assert!(actual.fps.is_finite() && expected.fps.is_finite());
        assert_eq!(actual.paired, expected.paired);
        assert_eq!(actual.frame_count, expected.frame_count);
        assert_eq!(actual.actors.len(), expected.actors.len());
        assert_eq!(actual.annotations.len(), expected.annotations.len());
        let mut maximum = 0.0_f32;
        compare_float(&mut maximum, "duration", actual.duration, expected.duration);
        compare_float(&mut maximum, "fps", actual.fps, expected.fps);
        for (left, right) in actual.annotations.iter().zip(&expected.annotations) {
            compare_float(&mut maximum, "annotation time", left.time, right.time);
            assert_eq!(left.text, right.text);
            assert_eq!(left.track, right.track);
        }
        for (left, right) in actual.actors.iter().zip(&expected.actors) {
            assert_eq!(left.bones.len(), right.bones.len());
            for (actual_bone, expected_bone) in left.bones.iter().zip(&right.bones) {
                assert_eq!(actual_bone.name, expected_bone.name);
                assert_eq!(actual_bone.parent, expected_bone.parent);
            }
            assert_eq!(left.matrices.len(), right.matrices.len());
            assert_eq!(left.root_translation.len(), right.root_translation.len());
            assert_eq!(left.root_yaw.len(), right.root_yaw.len());
            assert_eq!(left.trajectory.len(), right.trajectory.len());
            for (&a, &b) in left.matrices.iter().zip(&right.matrices) {
                compare_float(&mut maximum, "matrix", a, b);
            }
            for (a, b) in left.root_translation.iter().zip(&right.root_translation) {
                for axis in 0..3 {
                    compare_float(&mut maximum, "rootTranslation", a[axis], b[axis]);
                }
            }
            for (&a, &b) in left.root_yaw.iter().zip(&right.root_yaw) {
                compare_float(&mut maximum, "rootYaw", a, b);
            }
            for (a, b) in left.trajectory.iter().zip(&right.trajectory) {
                for axis in 0..3 {
                    compare_float(&mut maximum, "trajectory", a[axis], b[axis]);
                }
            }
            assert!(!left.matrices.is_empty(), "end frame must be present");
        }
        if std::env::var("AIE_VIEWER_REQUIRE_YAW").as_deref() == Ok("1") {
            assert!(actual.actors.iter().any(|actor| {
                actor
                    .root_yaw
                    .first()
                    .is_some_and(|first| actor.root_yaw.iter().any(|value| (value - first).abs() > 1e-5))
            }));
        }
        let matrix_bytes: usize = actual
            .actors
            .iter()
            .map(|actor| actor.matrices.len() * std::mem::size_of::<f32>())
            .sum();
        println!("maximum matrix/root/yaw/trajectory error: {maximum}");
        println!(
            "native decode: {:.3}s, matrix bytes: {matrix_bytes}, serialized response bytes: {}",
            elapsed.as_secs_f64(),
            encoded.len()
        );
        assert!(maximum < 1e-4, "maximum error {maximum}");
    }
}
