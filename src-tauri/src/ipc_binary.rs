//! Binary IPC frames for bulk numeric data (viewer matrices, GLB bytes).
//! Layout: [u32 LE header length][UTF-8 JSON header][zero padding to a 4-byte boundary][payload].
//! The payload follows the header's own description; JSON never carries the bulk numbers.

pub fn frame(
    header: &impl serde::Serialize,
    payload_len: usize,
    write: impl FnOnce(&mut Vec<u8>),
) -> Result<Vec<u8>, String> {
    let json = serde_json::to_vec(header).map_err(|e| e.to_string())?;
    let length = u32::try_from(json.len()).map_err(|_| "IPC header is too large.".to_owned())?;
    let start = (4 + json.len() + 3) & !3;
    let mut out = Vec::with_capacity(start + payload_len);
    out.extend_from_slice(&length.to_le_bytes());
    out.extend_from_slice(&json);
    out.resize(start, 0);
    write(&mut out);
    if out.len() != start + payload_len {
        return Err("IPC payload length mismatch.".into());
    }
    Ok(out)
}

/// Test helper: splits a frame back into its JSON header and payload.
#[cfg(test)]
pub fn split(bytes: &[u8]) -> (serde_json::Value, &[u8]) {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let header = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    (header, &bytes[(4 + length + 3) & !3..])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn header_is_padded_so_the_payload_is_four_byte_aligned() {
        for text in ["", "a", "ab", "abc", "한글"] {
            let bytes = frame(&serde_json::json!({"t": text}), 3, |out| {
                out.extend_from_slice(&[7, 8, 9])
            })
            .unwrap();
            let (header, payload) = split(&bytes);
            assert_eq!(header["t"], text);
            assert_eq!(payload, [7, 8, 9]);
            assert_eq!((bytes.len() - payload.len()) % 4, 0);
        }
        assert!(frame(&serde_json::json!({}), 4, |out| out.push(1)).is_err());
    }
}
