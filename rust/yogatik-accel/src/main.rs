use std::io::{self, BufRead, Write};

/// Result of fast acoustic VAD + prosody/emotion analysis.
#[derive(Debug, PartialEq)]
pub struct AudioAnalysis {
    pub rms: f32,
    pub zcr: f32,
    pub pitch_hz: f32,
    pub snr_db: f32,
    pub speech_active: bool,
    pub emotion: &'static str,
    pub confidence: f32,
}

/// Analyze raw f32 PCM samples (normalized -1.0..1.0) in microseconds.
pub fn analyze_audio(samples: &[f32], sample_rate: u32) -> AudioAnalysis {
    if samples.is_empty() || sample_rate == 0 {
        return AudioAnalysis {
            rms: 0.0,
            zcr: 0.0,
            pitch_hz: 0.0,
            snr_db: 0.0,
            speech_active: false,
            emotion: "calm",
            confidence: 0.0,
        };
    }

    let n = samples.len() as f32;
    let mut sum_sq = 0.0f32;
    let mut crossings = 0usize;
    let mut prev = samples[0];

    for &s in samples {
        sum_sq += s * s;
        if (s >= 0.0 && prev < 0.0) || (s < 0.0 && prev >= 0.0) {
            crossings += 1;
        }
        prev = s;
    }

    let rms = (sum_sq / n).sqrt();
    let zcr = crossings as f32 / n;
    let speech_active = rms > 0.015 && zcr < 0.45;

    // Fast normalized autocorrelation pitch (F0) over 80Hz..400Hz
    let mut pitch_hz = 0.0f32;
    if speech_active && samples.len() > 256 {
        let min_lag = (sample_rate / 400).max(2) as usize;
        let max_lag = (sample_rate / 80).min((samples.len() / 2) as u32) as usize;
        let win = samples.len().min(1024);
        let mut best_corr = 0.0f32;
        let mut best_lag = 0usize;
        let mut passed_peak = false;

        for lag in min_lag..=max_lag {
            let limit = win.saturating_sub(lag);
            if limit < 32 {
                break;
            }
            let mut num = 0.0f32;
            let mut den_a = 0.0f32;
            let mut den_b = 0.0f32;
            for i in 0..limit {
                let a = samples[i];
                let b = samples[i + lag];
                num += a * b;
                den_a += a * a;
                den_b += b * b;
            }
            let denom = (den_a * den_b).sqrt();
            if denom > 1e-6 {
                let corr = num / denom;
                if corr > best_corr {
                    best_corr = corr;
                    best_lag = lag;
                    passed_peak = false;
                } else if best_corr > 0.85 && corr < best_corr - 0.02 {
                    passed_peak = true;
                }
                if passed_peak {
                    break;
                }
            }
        }
        if best_corr > 0.45 && best_lag > 0 {
            pitch_hz = sample_rate as f32 / best_lag as f32;
        }
    }

    let (emotion, confidence) = if !speech_active {
        ("calm", 0.5)
    } else if rms > 0.14 && pitch_hz > 210.0 {
        ("excited", 0.78)
    } else if rms > 0.12 && zcr > 0.16 {
        ("urgent", 0.74)
    } else if pitch_hz > 185.0 {
        ("curious", 0.68)
    } else if rms < 0.045 && pitch_hz > 0.0 && pitch_hz < 135.0 {
        ("calm", 0.72)
    } else {
        ("neutral", 0.65)
    };

    let snr_db = if rms > 1e-6 {
        (20.0 * (rms / 0.008f32).log10()).clamp(0.0, 60.0)
    } else {
        0.0
    };

    AudioAnalysis {
        rms,
        zcr,
        pitch_hz,
        snr_db,
        speech_active,
        emotion,
        confidence,
    }
}

/// Compute a 64-bit perceptual difference hash (dHash) on a 9x8 downsampled luma grid.
pub fn compute_dhash(luma_9x8: &[u8]) -> u64 {
    if luma_9x8.len() < 72 {
        return 0;
    }
    let mut hash = 0u64;
    let mut bit = 0u32;
    for row in 0..8 {
        let base = row * 9;
        for col in 0..8 {
            if luma_9x8[base + col] > luma_9x8[base + col + 1] {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    hash
}

pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Sub-millisecond query intent classification for live voice turns.
pub fn classify_query(text: &str, has_visual: bool) -> &'static str {
    let lower = text.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return "chat";
    }
    if lower.contains("deep research") || lower.contains("in depth") || lower.contains("comprehensive report") {
        return "deep_research";
    }
    if has_visual
        && (lower.contains("see")
            || lower.contains("look")
            || lower.contains("camera")
            || lower.contains("screen")
            || lower.contains("holding")
            || lower.contains("this")
            || lower.contains("what is in front"))
    {
        return "visual";
    }
    if lower.contains("news")
        || lower.contains("weather")
        || lower.contains("price")
        || lower.contains("score")
        || lower.contains("today")
        || lower.contains("latest")
        || lower.contains("search")
        || lower.contains("who won")
    {
        return "search";
    }
    if lower.contains("```")
        || lower.contains("function ")
        || lower.contains("debug")
        || lower.contains("refactor")
        || lower.contains("compile")
        || lower.contains("typescript")
        || lower.contains("rust")
        || lower.contains("python")
    {
        return "code";
    }
    if lower.contains("prove")
        || lower.contains("derive")
        || lower.contains("step by step")
        || lower.contains("analyze")
        || lower.contains("compare")
    {
        return "reasoning";
    }
    "chat"
}

/// Fast UTF-8 / CJK-aware token count estimation.
/// Returns (tokens, total_chars, cjk_chars).
pub fn estimate_tokens(text: &str) -> (usize, usize, usize) {
    if text.is_empty() {
        return (0, 0, 0);
    }
    let mut total_chars = 0usize;
    let mut cjk_chars = 0usize;
    for ch in text.chars() {
        total_chars += 1;
        let cp = ch as u32;
        if (0x4E00..=0x9FFF).contains(&cp)
            || (0x3040..=0x30FF).contains(&cp)
            || (0xAC00..=0xD7AF).contains(&cp)
        {
            cjk_chars += 1;
        }
    }
    let latin_chars = total_chars.saturating_sub(cjk_chars);
    let est = ((latin_chars as f64 / 3.8) + (cjk_chars as f64 / 1.5)).ceil() as usize;
    (est.max(1), total_chars, cjk_chars)
}

/// Fast f32 cosine similarity between two embedding vectors.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let n = a.len().min(b.len());
    if n == 0 {
        return 0.0;
    }
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..n {
        let x = a[i];
        let y = b[i];
        dot += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }
    let denom = (norm_a * norm_b).sqrt();
    if denom > 1e-9 {
        dot / denom
    } else {
        0.0
    }
}

/// Batch top-K cosine similarity ranking for RAG vector search.
pub fn top_k_similarity(query: &[f32], docs: &[Vec<f32>], k: usize) -> Vec<(usize, f32)> {
    if query.is_empty() || docs.is_empty() || k == 0 {
        return Vec::new();
    }
    let mut scored: Vec<(usize, f32)> = docs
        .iter()
        .enumerate()
        .map(|(i, d)| (i, cosine_similarity(query, d)))
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(k);
    scored
}

#[derive(Clone, Debug)]
pub struct DetectionBox {
    pub orig_idx: usize,
    pub label: String,
    pub score: f32,
    pub xmin: f32,
    pub ymin: f32,
    pub xmax: f32,
    pub ymax: f32,
}

/// Per-class Non-Maximum Suppression (NMS) in native Rust.
pub fn deduplicate_detections(
    mut dets: Vec<DetectionBox>,
    iou_thresh: f32,
    containment_thresh: f32,
    max_det: usize,
) -> Vec<usize> {
    dets.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    let mut kept: Vec<DetectionBox> = Vec::with_capacity(max_det.min(dets.len()));
    for d in dets {
        let dup = kept.iter().any(|e| {
            if !e.label.eq_ignore_ascii_case(&d.label) {
                return false;
            }
            let ix1 = e.xmin.max(d.xmin);
            let iy1 = e.ymin.max(d.ymin);
            let ix2 = e.xmax.min(d.xmax);
            let iy2 = e.ymax.min(d.ymax);
            let inter = (ix2 - ix1).max(0.0) * (iy2 - iy1).max(0.0);
            if inter <= 0.0 {
                return false;
            }
            let area_a = (e.xmax - e.xmin).max(0.0) * (e.ymax - e.ymin).max(0.0);
            let area_b = (d.xmax - d.xmin).max(0.0) * (d.ymax - d.ymin).max(0.0);
            let union = area_a + area_b - inter;
            let min_area = area_a.min(area_b);
            let iou = if union > 0.0 { inter / union } else { 0.0 };
            let cont = if min_area > 0.0 { inter / min_area } else { 0.0 };
            iou >= iou_thresh || cont >= containment_thresh
        });
        if !dup {
            kept.push(d);
            if kept.len() >= max_det {
                break;
            }
        }
    }
    kept.into_iter().map(|d| d.orig_idx).collect()
}

fn parse_f32_list(raw: &str) -> Vec<f32> {
    raw.split(',')
        .filter_map(|s| s.trim().parse::<f32>().ok())
        .collect()
}

fn parse_u8_list(raw: &str) -> Vec<u8> {
    raw.split(',')
        .filter_map(|s| s.trim().parse::<u8>().ok())
        .collect()
}

/// Minimal zero-dependency stdio protocol:
/// - `AUDIO <sample_rate> <comma-separated f32 samples>`
/// - `DHASH <prev_hash_hex> <72 comma-separated u8 luma values>`
/// - `ROUTE <has_visual:0|1> <query text>`
/// - `TOKENS <text>`
/// - `COSINE <vecA>|<vecB>`
/// - `TOPK <k> <query>|<doc1>;<doc2>;...`
/// - `NMS <iou> <containment> <max> <label,score,xmin,ymin,xmax,ymax;...>`
fn handle_line(line: &str) -> String {
    let trimmed = line.trim();
    if let Some(rest) = trimmed.strip_prefix("AUDIO ") {
        let mut parts = rest.splitn(2, ' ');
        let sr = parts.next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(16000);
        let samples = parts.next().map(parse_f32_list).unwrap_or_default();
        let res = analyze_audio(&samples, sr);
        return format!(
            "{{\"rms\":{:.5},\"zcr\":{:.5},\"pitchHz\":{:.2},\"snrDb\":{:.2},\"speechActive\":{},\"emotion\":\"{}\",\"confidence\":{:.2}}}",
            res.rms, res.zcr, res.pitch_hz, res.snr_db, res.speech_active, res.emotion, res.confidence
        );
    }
    if let Some(rest) = trimmed.strip_prefix("DHASH ") {
        let mut parts = rest.splitn(2, ' ');
        let prev = parts
            .next()
            .and_then(|s| u64::from_str_radix(s.trim(), 16).ok())
            .unwrap_or(0);
        let luma = parts.next().map(parse_u8_list).unwrap_or_default();
        let hash = compute_dhash(&luma);
        let dist = hamming_distance(prev, hash);
        return format!("{{\"hash\":\"{:016x}\",\"distance\":{}}}", hash, dist);
    }
    if let Some(rest) = trimmed.strip_prefix("ROUTE ") {
        let mut parts = rest.splitn(2, ' ');
        let has_vis = parts.next().unwrap_or("0") == "1";
        let q = parts.next().unwrap_or("");
        let intent = classify_query(q, has_vis);
        return format!("{{\"intent\":\"{}\"}}", intent);
    }
    if let Some(rest) = trimmed.strip_prefix("TOKENS ") {
        let (tokens, chars, cjk) = estimate_tokens(rest);
        return format!("{{\"tokens\":{},\"chars\":{},\"cjkChars\":{}}}", tokens, chars, cjk);
    }
    if let Some(rest) = trimmed.strip_prefix("COSINE ") {
        let mut parts = rest.splitn(2, '|');
        let a = parts.next().map(parse_f32_list).unwrap_or_default();
        let b = parts.next().map(parse_f32_list).unwrap_or_default();
        let sim = cosine_similarity(&a, &b);
        return format!("{{\"similarity\":{:.6}}}", sim);
    }
    if let Some(rest) = trimmed.strip_prefix("TOPK ") {
        let mut head = rest.splitn(2, ' ');
        let k = head.next().and_then(|s| s.parse::<usize>().ok()).unwrap_or(5);
        let body = head.next().unwrap_or("");
        let mut parts = body.splitn(2, '|');
        let q = parts.next().map(parse_f32_list).unwrap_or_default();
        let docs: Vec<Vec<f32>> = parts
            .next()
            .unwrap_or("")
            .split(';')
            .filter(|s| !s.trim().is_empty())
            .map(parse_f32_list)
            .collect();
        let top = top_k_similarity(&q, &docs, k);
        let idxs: Vec<String> = top.iter().map(|(i, _)| i.to_string()).collect();
        let scores: Vec<String> = top.iter().map(|(_, s)| format!("{:.6}", s)).collect();
        return format!(
            "{{\"indices\":[{}],\"scores\":[{}]}}",
            idxs.join(","),
            scores.join(",")
        );
    }
    if let Some(rest) = trimmed.strip_prefix("NMS ") {
        let mut parts = rest.splitn(4, ' ');
        let iou = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.45);
        let cont = parts.next().and_then(|s| s.parse::<f32>().ok()).unwrap_or(0.80);
        let max_det = parts.next().and_then(|s| s.parse::<usize>().ok()).unwrap_or(8);
        let raw_list = parts.next().unwrap_or("");
        let mut dets = Vec::new();
        for (idx, item) in raw_list.split(';').enumerate() {
            let cols: Vec<&str> = item.split(',').collect();
            if cols.len() == 6 {
                dets.push(DetectionBox {
                    orig_idx: idx,
                    label: cols[0].trim().to_string(),
                    score: cols[1].trim().parse::<f32>().unwrap_or(0.0),
                    xmin: cols[2].trim().parse::<f32>().unwrap_or(0.0),
                    ymin: cols[3].trim().parse::<f32>().unwrap_or(0.0),
                    xmax: cols[4].trim().parse::<f32>().unwrap_or(0.0),
                    ymax: cols[5].trim().parse::<f32>().unwrap_or(0.0),
                });
            }
        }
        let kept = deduplicate_detections(dets, iou, cont, max_det);
        let kept_str: Vec<String> = kept.iter().map(|i| i.to_string()).collect();
        return format!("{{\"kept\":[{}]}}", kept_str.join(","));
    }
    "{\"error\":\"unknown_command\"}".to_string()
}

fn main() {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    for line in stdin.lock().lines().map_while(Result::ok) {
        if line.trim().is_empty() {
            continue;
        }
        let resp = handle_line(&line);
        let _ = writeln!(out, "{}", resp);
        let _ = out.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_silence_and_sine_pitch() {
        let silence = vec![0.0f32; 512];
        let s_res = analyze_audio(&silence, 16000);
        assert!(!s_res.speech_active);
        assert_eq!(s_res.emotion, "calm");

        // 200Hz sine wave at 16kHz
        let tone: Vec<f32> = (0..1024)
            .map(|i| 0.2 * (2.0 * std::f32::consts::PI * 200.0 * i as f32 / 16000.0).sin())
            .collect();
        let t_res = analyze_audio(&tone, 16000);
        assert!(t_res.speech_active);
        assert!((t_res.pitch_hz - 200.0).abs() < 10.0);
    }

    #[test]
    fn computes_dhash_and_hamming_distance() {
        let mut grid_a = vec![10u8; 72];
        grid_a[0] = 200;
        let mut grid_b = grid_a.clone();
        grid_b[1] = 220;
        let ha = compute_dhash(&grid_a);
        let hb = compute_dhash(&grid_b);
        assert_ne!(ha, hb);
        assert!(hamming_distance(ha, hb) <= 2);
    }

    #[test]
    fn classifies_queries_fast() {
        assert_eq!(classify_query("what am I holding", true), "visual");
        assert_eq!(classify_query("latest news today", false), "search");
        assert_eq!(classify_query("do deep research on fusion", false), "deep_research");
        assert_eq!(classify_query("refactor this rust function", false), "code");
        assert_eq!(classify_query("hello friend", false), "chat");
    }

    #[test]
    fn estimates_tokens_and_ranks_topk_cosine() {
        let (toks, chars, cjk) = estimate_tokens("hello world");
        assert_eq!(chars, 11);
        assert_eq!(cjk, 0);
        assert_eq!(toks, 3);

        let (cjk_toks, _, cjk_count) = estimate_tokens("你好世界");
        assert_eq!(cjk_count, 4);
        assert!(cjk_toks >= 3);

        let q = vec![1.0, 0.0, 0.0];
        let docs = vec![vec![0.0, 1.0, 0.0], vec![0.9, 0.1, 0.0], vec![0.5, 0.5, 0.0]];
        let top = top_k_similarity(&q, &docs, 2);
        assert_eq!(top.len(), 2);
        assert_eq!(top[0].0, 1);
    }

    #[test]
    fn deduplicates_overlapping_boxes_with_nms() {
        let resp = handle_line("NMS 0.45 0.8 8 couch,0.87,0.1,0.5,0.5,0.9;couch,0.89,0.11,0.51,0.52,0.91;person,0.95,0.3,0.2,0.7,0.95");
        assert_eq!(resp, "{\"kept\":[2,1]}");
    }
}
