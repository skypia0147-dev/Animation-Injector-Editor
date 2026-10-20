// SPDX-License-Identifier: GPL-3.0-only
//
// This decoder is a Rust port of HKX_Viewer/hkx_spline.py, which in turn ports
// PredatorCZ/HavokLib source/hka_spline_decompressor.cpp.
// Original HavokLib copyright (C) 2016-2023 Lukas Cone.
// Modified for Animation Injector Editor in 2026.

use std::f64::consts::PI;

const QT_8BIT: u8 = 0;
const QT_16BIT: u8 = 1;
const QT_32BIT: u8 = 2;
const QT_40BIT: u8 = 3;
const QT_48BIT: u8 = 4;
const QT_16BIT_QUAT: u8 = 6;
const QT_UNCOMPRESSED: u8 = 7;

const MAX_BLOCK_TRACKS: usize = 262_144;
const MAX_DECODE_VALUES: usize = 4_000_000;

type Vec3 = [f64; 3];
type Quat = [f64; 4]; // x, y, z, w

struct DecodeBudget {
    remaining_values: usize,
}

impl DecodeBudget {
    fn new() -> Self {
        Self {
            remaining_values: MAX_DECODE_VALUES,
        }
    }

    fn charge(&mut self, count: usize) -> Result<(), String> {
        self.remaining_values = self
            .remaining_values
            .checked_sub(count)
            .ok_or("HKX 스플라인 제어점/knot 총량이 디코드 메모리 제한을 넘습니다.")?;
        Ok(())
    }
}

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8], pos: usize) -> Result<Self, String> {
        if pos > data.len() {
            return Err("스플라인 블록 오프셋이 데이터 범위를 벗어났습니다.".into());
        }
        Ok(Self { data, pos })
    }

    fn take(&mut self, count: usize) -> Result<&'a [u8], String> {
        let end = self
            .pos
            .checked_add(count)
            .ok_or("스플라인 데이터 오프셋이 넘쳤습니다.")?;
        let out = self
            .data
            .get(self.pos..end)
            .ok_or("스플라인 데이터가 중간에서 끝났습니다.")?;
        self.pos = end;
        Ok(out)
    }

    fn u8(&mut self) -> Result<u8, String> {
        Ok(self.take(1)?[0])
    }

    fn u16(&mut self) -> Result<u16, String> {
        let b = self.take(2)?;
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    fn f32(&mut self) -> Result<f64, String> {
        let b = self.take(4)?;
        Ok(f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64)
    }

    fn pad(&mut self, alignment: usize) -> Result<(), String> {
        let remainder = self.pos & (alignment - 1);
        if remainder != 0 {
            self.take(alignment - remainder)?;
        }
        Ok(())
    }
}

fn fraction(bits: u32) -> f64 {
    1.0 / ((1_u64 << bits) - 1) as f64
}

fn compute_w(mut value: Quat) -> Quat {
    value[3] = (1.0 - value[0] * value[0] - value[1] * value[1] - value[2] * value[2])
        .max(0.0)
        .sqrt();
    value
}

fn shuffle([a, b, c, w]: Quat, shift: u64) -> Quat {
    match shift {
        0 => [w, a, b, c],
        1 => [a, w, b, c],
        2 => [a, b, w, c],
        _ => [a, b, c, w],
    }
}

fn read32(cur: &mut Cursor<'_>) -> Result<Quat, String> {
    let b = cur.take(4)?;
    let packed = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let mask = (1_u32 << 10) - 1;
    let mut radius = ((packed >> 18) & mask) as f64 * fraction(10);
    radius = 1.0 - radius * radius;
    let phi_theta = (packed & 0x3ffff) as f64;
    let mut phi = phi_theta.sqrt().floor();
    let mut theta = 0.0;
    if phi > 0.0 {
        theta = (PI * 0.25) * (phi_theta - phi * phi) / phi;
        phi *= (PI * 0.5) / 511.0;
    }
    let magnitude = (1.0 - radius * radius).max(0.0).sqrt();
    let mut value = [
        phi.sin() * theta.cos() * magnitude,
        phi.sin() * theta.sin() * magnitude,
        phi.cos() * magnitude,
        radius,
    ];
    for (bit, component) in [0x10000000, 0x20000000, 0x40000000, 0x80000000]
        .into_iter()
        .zip(value.iter_mut())
    {
        if packed & bit != 0 {
            *component = -*component;
        }
    }
    Ok(value)
}

fn read40(cur: &mut Cursor<'_>) -> Result<Quat, String> {
    let b = cur.take(5)?;
    let packed = u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], 0, 0, 0]);
    let packed_hi = ((packed >> 24) & 0xffff_ffff) as u32;
    let low = packed as u32;
    let l0 = low.wrapping_mul(1 << 20) >> 20;
    let l1 = low.wrapping_mul(1 << 8) >> 20;
    let l2 = packed_hi.wrapping_mul(1 << 20) >> 20;
    let mask = (1_u32 << 11) - 1;
    let mut value = compute_w([
        (l0 as f64 - mask as f64) * 0.000345436,
        (l1 as f64 - mask as f64) * 0.000345436,
        (l2 as f64 - mask as f64) * 0.000345436,
        0.0,
    ]);
    if (packed >> 38) & 1 != 0 {
        value[3] = -value[3];
    }
    Ok(shuffle(value, (packed >> 36) & 3))
}

fn read48(cur: &mut Cursor<'_>) -> Result<Quat, String> {
    let x = cur.u16()?;
    let y = cur.u16()?;
    let z = cur.u16()?;
    let mask = (1_u16 << 15) - 1;
    let shift = (((y >> 14) & 2) | ((x >> 15) & 1)) as u64;
    let sign = z >> 15 != 0;
    let half = (mask >> 1) as f64;
    let mut value = compute_w([
        ((x & mask) as f64 - half) * 0.000043161,
        ((y & mask) as f64 - half) * 0.000043161,
        ((z & mask) as f64 - half) * 0.000043161,
        0.0,
    ]);
    if sign {
        value[3] = -value[3];
    }
    Ok(shuffle(value, shift))
}

fn read_quat(kind: u8, cur: &mut Cursor<'_>) -> Result<Quat, String> {
    match kind {
        QT_32BIT => read32(cur),
        QT_40BIT => read40(cur),
        QT_48BIT => read48(cur),
        QT_UNCOMPRESSED => Ok([cur.f32()?, cur.f32()?, cur.f32()?, cur.f32()?]),
        _ => Ok([0.0, 0.0, 0.0, 1.0]),
    }
}

fn sub_track(flags: u8, axis: usize) -> TrackKind {
    if flags & (1 << axis) != 0 {
        TrackKind::Static
    } else if flags & (1 << (4 + axis)) != 0 {
        TrackKind::Dynamic
    } else {
        TrackKind::Identity
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TrackKind {
    Identity,
    Static,
    Dynamic,
}

fn rotation_kind(mask: &[u8; 4]) -> TrackKind {
    if mask[2] & 0xf0 != 0 {
        TrackKind::Dynamic
    } else if mask[2] & 0x0f != 0 {
        TrackKind::Static
    } else {
        TrackKind::Identity
    }
}

enum VectorTrack {
    Static(Vec3),
    Spline {
        components: [Vec<f64>; 3],
        knots: Vec<u8>,
        degree: usize,
    },
}

enum RotationTrack {
    Static(Quat),
    Spline {
        points: Vec<Quat>,
        knots: Vec<u8>,
        degree: usize,
    },
}

struct Track {
    position: VectorTrack,
    rotation: RotationTrack,
    scale: VectorTrack,
}

fn knots(cur: &mut Cursor<'_>, count: usize, degree: usize, budget: &mut DecodeBudget) -> Result<Vec<u8>, String> {
    if degree > 16 || count > 65_535 {
        return Err("스플라인 차수 또는 제어점 개수가 너무 큽니다.".into());
    }
    let length = count
        .checked_add(degree)
        .and_then(|n| n.checked_add(2))
        .ok_or("스플라인 knot 개수가 넘쳤습니다.")?;
    budget.charge(length)?;
    Ok(cur.take(length)?.to_vec())
}

fn make_vector_track(
    cur: &mut Cursor<'_>,
    mask: &[u8; 4],
    quantization: u8,
    default: f64,
    scale: bool,
    budget: &mut DecodeBudget,
) -> Result<VectorTrack, String> {
    let flags = if scale { mask[3] } else { mask[1] };
    let kinds: [TrackKind; 3] = std::array::from_fn(|axis| sub_track(flags, axis));
    if kinds.contains(&TrackKind::Dynamic) {
        let count = cur.u16()? as usize;
        let degree = cur.u8()? as usize;
        let knots = knots(cur, count, degree, budget)?;
        cur.pad(4)?;
        let mut components: [Vec<f64>; 3] = std::array::from_fn(|_| Vec::new());
        let mut extremes: [Option<(f64, f64)>; 3] = [None, None, None];
        let point_count = count.checked_add(1).ok_or("스플라인 제어점 개수가 넘쳤습니다.")?;
        budget.charge(
            point_count
                .checked_mul(kinds.iter().filter(|kind| **kind == TrackKind::Dynamic).count())
                .ok_or("스플라인 벡터 제어점 총량이 넘쳤습니다.")?,
        )?;
        for axis in 0..3 {
            match kinds[axis] {
                TrackKind::Dynamic => {
                    extremes[axis] = Some((cur.f32()?, cur.f32()?));
                    components[axis].resize(point_count, 0.0);
                }
                TrackKind::Static => components[axis].push(cur.f32()?),
                TrackKind::Identity => components[axis].push(default),
            }
        }
        for point in 0..=count {
            for axis in 0..3 {
                if let Some((min, max)) = extremes[axis] {
                    let fraction = match quantization {
                        QT_8BIT => cur.u8()? as f64 / 255.0,
                        QT_16BIT => cur.u16()? as f64 / 65_535.0,
                        _ => return Err("지원하지 않는 벡터 양자화 형식입니다.".into()),
                    };
                    let value = min + (max - min) * fraction;
                    components[axis][point] = if value.is_finite() { value } else { default };
                }
            }
        }
        cur.pad(4)?;
        Ok(VectorTrack::Spline {
            components,
            knots,
            degree,
        })
    } else {
        let mut value = [default; 3];
        for axis in 0..3 {
            if kinds[axis] == TrackKind::Static {
                value[axis] = cur.f32()?;
            }
        }
        Ok(VectorTrack::Static(value))
    }
}

fn make_rotation_track(
    cur: &mut Cursor<'_>,
    mask: &[u8; 4],
    budget: &mut DecodeBudget,
) -> Result<RotationTrack, String> {
    let quantization = ((mask[0] >> 2) & 0x0f) + 2;
    match rotation_kind(mask) {
        TrackKind::Dynamic => {
            let count = cur.u16()? as usize;
            let degree = cur.u8()? as usize;
            let knots = knots(cur, count, degree, budget)?;
            let point_count = count.checked_add(1).ok_or("스플라인 회전 제어점 개수가 넘쳤습니다.")?;
            budget.charge(
                point_count
                    .checked_mul(4)
                    .ok_or("스플라인 회전 제어점 총량이 넘쳤습니다.")?,
            )?;
            match quantization {
                QT_48BIT | QT_16BIT_QUAT => cur.pad(2)?,
                QT_32BIT | QT_UNCOMPRESSED => cur.pad(4)?,
                _ => {}
            }
            let mut points = Vec::with_capacity(point_count);
            for _ in 0..point_count {
                points.push(read_quat(quantization, cur)?);
            }
            Ok(RotationTrack::Spline { points, knots, degree })
        }
        TrackKind::Static => Ok(RotationTrack::Static(read_quat(quantization, cur)?)),
        TrackKind::Identity => Ok(RotationTrack::Static([0.0, 0.0, 0.0, 1.0])),
    }
}

fn find_span(degree: usize, value: f64, control_count: usize, knots: &[u8]) -> Result<usize, String> {
    if control_count == 0 || degree >= control_count || knots.len() <= control_count {
        return Err("스플라인 knot/제어점 구성이 유효하지 않습니다.".into());
    }
    if value >= knots[control_count] as f64 {
        return Ok(control_count - 1);
    }
    let (mut low, mut high) = (degree, control_count);
    let mut middle = (low + high) / 2;
    for _ in 0..64 {
        if value >= knots[middle] as f64 && value < knots[middle + 1] as f64 {
            return Ok(middle);
        }
        if value < knots[middle] as f64 {
            high = middle;
        } else {
            low = middle;
        }
        let next = (low + high) / 2;
        if next == middle {
            break;
        }
        middle = next;
    }
    Err("스플라인 knot에서 프레임 구간을 찾지 못했습니다.".into())
}

fn basis(span: usize, degree: usize, frame: f64, knots: &[u8]) -> Result<Vec<f64>, String> {
    let mut values = vec![0.0; degree + 1];
    values[0] = 1.0;
    for i in 1..=degree {
        for j in (0..i).rev() {
            let left = *knots.get(span - j).ok_or("스플라인 knot 왼쪽 범위 오류")? as f64;
            let right = *knots.get(span + i - j).ok_or("스플라인 knot 오른쪽 범위 오류")? as f64;
            let denominator = right - left;
            if denominator == 0.0 {
                return Err("스플라인 knot 간격이 0입니다.".into());
            }
            let amount = (frame - left) / denominator;
            let temporary = values[j] * amount;
            values[j + 1] += values[j] - temporary;
            values[j] = temporary;
        }
    }
    Ok(values)
}

fn evaluate_vector(track: &VectorTrack, frame: f64) -> Result<Vec3, String> {
    let VectorTrack::Spline {
        components,
        knots,
        degree,
    } = track
    else {
        return Ok(match track {
            VectorTrack::Static(value) => *value,
            VectorTrack::Spline { .. } => unreachable!(),
        });
    };
    let mut result = [0.0; 3];
    let mut cached = None;
    for axis in 0..3 {
        if components[axis].len() == 1 {
            result[axis] = components[axis][0];
            continue;
        }
        let span = match cached {
            Some(value) => value,
            None => {
                let value = find_span(*degree, frame, components[axis].len(), knots)?;
                cached = Some(value);
                value
            }
        };
        let weights = basis(span, *degree, frame, knots)?;
        for (index, weight) in weights.into_iter().enumerate() {
            result[axis] += components[axis][span - index] * weight;
        }
    }
    Ok(result)
}

fn evaluate_rotation(track: &RotationTrack, frame: f64) -> Result<Quat, String> {
    match track {
        RotationTrack::Static(value) => Ok(*value),
        RotationTrack::Spline { points, knots, degree } => {
            let span = find_span(*degree, frame, points.len(), knots)?;
            let weights = basis(span, *degree, frame, knots)?;
            let mut result = [0.0; 4];
            for (index, weight) in weights.into_iter().enumerate() {
                for (component, result_component) in result.iter_mut().enumerate() {
                    *result_component += points[span - index][component] * weight;
                }
            }
            Ok(result)
        }
    }
}

fn decode_block(
    data: &[u8],
    offset: usize,
    transform_tracks: usize,
    float_tracks: usize,
    budget: &mut DecodeBudget,
) -> Result<Vec<Track>, String> {
    let masks_end = offset
        .checked_add(transform_tracks.checked_mul(4).ok_or("트랙 개수가 너무 큽니다.")?)
        .ok_or("스플라인 마스크 오프셋이 넘쳤습니다.")?;
    let masks = data
        .get(offset..masks_end)
        .ok_or("스플라인 마스크가 데이터 범위를 벗어났습니다.")?;
    let mut cur = Cursor::new(
        data,
        masks_end
            .checked_add(float_tracks)
            .ok_or("float 트랙 오프셋이 넘쳤습니다.")?,
    )?;
    cur.pad(4)?;
    let mut result = Vec::with_capacity(transform_tracks);
    for index in 0..transform_tracks {
        let start = index * 4;
        let mask: [u8; 4] = masks[start..start + 4]
            .try_into()
            .map_err(|_| "스플라인 마스크 크기가 유효하지 않습니다.")?;
        let position = make_vector_track(&mut cur, &mask, mask[0] & 3, 0.0, false, budget)?;
        let rotation = make_rotation_track(&mut cur, &mask, budget)?;
        cur.pad(4)?;
        let scale = make_vector_track(&mut cur, &mask, (mask[0] >> 6) & 3, 1.0, true, budget)?;
        result.push(Track {
            position,
            rotation,
            scale,
        });
    }
    Ok(result)
}

pub struct SplineAnimation {
    tracks: usize,
    frames: usize,
    frames_per_block: usize,
    blocks: Vec<Vec<Track>>,
}

impl SplineAnimation {
    pub fn new(
        data: &[u8],
        block_offsets: &[u32],
        transform_tracks: usize,
        float_tracks: usize,
        frames: usize,
        frames_per_block: usize,
    ) -> Result<Self, String> {
        if transform_tracks == 0 || transform_tracks > 4096 {
            return Err("HKX 변환 트랙 개수가 유효하지 않습니다.".into());
        }
        if frames == 0 || frames > 100_000 || frames_per_block == 0 || frames_per_block > 4096 {
            return Err("HKX 프레임 또는 블록 크기가 유효하지 않습니다.".into());
        }
        if float_tracks > 4096 {
            return Err("HKX float 트랙 개수가 너무 큽니다.".into());
        }
        if block_offsets.is_empty() || block_offsets.len() > 4096 {
            return Err("HKX 스플라인 블록 목록이 비어 있거나 너무 큽니다.".into());
        }
        let expected_blocks = frames
            .checked_add(frames_per_block - 1)
            .ok_or("HKX 블록 개수 계산이 넘쳤습니다.")?
            / frames_per_block;
        if block_offsets.len() != expected_blocks {
            return Err("HKX 스플라인 블록 수가 프레임 수와 맞지 않습니다.".into());
        }
        let block_tracks = block_offsets
            .len()
            .checked_mul(transform_tracks)
            .ok_or("HKX 블록×트랙 총량이 넘쳤습니다.")?;
        if block_tracks > MAX_BLOCK_TRACKS {
            return Err("HKX 블록×트랙 총량이 디코드 메모리 제한을 넘습니다.".into());
        }
        if block_offsets.iter().any(|offset| *offset as usize >= data.len()) {
            return Err("HKX 스플라인 블록 오프셋이 데이터 범위를 벗어났습니다.".into());
        }
        if block_offsets.windows(2).any(|pair| pair[0] >= pair[1]) {
            return Err("HKX 스플라인 블록 오프셋은 중복 없이 오름차순이어야 합니다.".into());
        }
        let mut blocks = Vec::with_capacity(block_offsets.len());
        let mut budget = DecodeBudget::new();
        for &offset in block_offsets {
            blocks.push(decode_block(
                data,
                offset as usize,
                transform_tracks,
                float_tracks,
                &mut budget,
            )?);
        }
        Ok(Self {
            tracks: transform_tracks,
            frames,
            frames_per_block,
            blocks,
        })
    }

    pub fn local_transform(&self, track: usize, frame: usize) -> Result<(Vec3, Quat, Vec3), String> {
        if track >= self.tracks || frame >= self.frames {
            return Err("스플라인 트랙 또는 프레임이 범위를 벗어났습니다.".into());
        }
        let block = (frame / self.frames_per_block).min(self.blocks.len() - 1);
        let local_frame = (frame - block * self.frames_per_block) as f64;
        let value = self.blocks[block]
            .get(track)
            .ok_or("스플라인 블록의 트랙이 누락됐습니다.")?;
        Ok((
            evaluate_vector(&value.position, local_frame)?,
            evaluate_rotation(&value.rotation, local_frame)?,
            evaluate_vector(&value.scale, local_frame)?,
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_identity_track_decodes() {
        let data = [0_u8; 4];
        let animation = SplineAnimation::new(&data, &[0], 1, 0, 1, 256).unwrap();
        assert_eq!(
            animation.local_transform(0, 0).unwrap(),
            ([0.0; 3], [0.0, 0.0, 0.0, 1.0], [1.0; 3])
        );
    }

    #[test]
    fn malformed_data_is_rejected() {
        assert!(SplineAnimation::new(&[], &[100], 1, 0, 1, 256).is_err());
        assert!(SplineAnimation::new(&[], &[], 1, 0, 1, 256).is_err());
        assert!(SplineAnimation::new(&[0; 8], &[0, 0], 1, 0, 2, 1).is_err());
        assert!(SplineAnimation::new(&[0; 4], &vec![0; 257], 1024, 0, 257, 1).is_err());
        assert!(SplineAnimation::new(&[0; 8], &[0, 4], 1, 0, 1, 256).is_err());
    }

    #[test]
    fn cumulative_control_value_budget_is_enforced() {
        let mut budget = DecodeBudget::new();
        assert!(budget.charge(MAX_DECODE_VALUES).is_ok());
        assert!(budget.charge(1).is_err());
    }
}
