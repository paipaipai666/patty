use std::process::Command;
use std::sync::{LazyLock, Mutex};

// Font names from the registry come back in the console's OEM codepage, so
// decode with the active codepage (chcp) instead of assuming UTF-8.
fn codepage_encoding() -> &'static encoding_rs::Encoding {
    static CACHE: LazyLock<&'static encoding_rs::Encoding> = LazyLock::new(|| {
        let label = detect_codepage_label();
        encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8)
    });
    *CACHE
}

fn detect_codepage_label() -> String {
    let Ok(out) = Command::new("chcp").output() else {
        return "utf-8".into();
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    // chcp prints the digits in ASCII, so a loose numeric match is language-safe.
    let cp: Option<u32> = stdout
        .chars()
        .filter(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok();
    // CP437/CP850 are approximated as latin1 — their extended ranges differ
    // from ISO-8859-1, so accented glyphs may be slightly off (same as the TS版).
    match cp {
        Some(437) | Some(850) => "latin1".into(),
        Some(1252) => "windows-1252".into(),
        Some(936) => "gbk".into(),
        Some(932) => "shift_jis".into(),
        Some(949) => "euc-kr".into(),
        _ => "utf-8".into(),
    }
}

fn scan_font_key(key: &str) -> Option<Vec<u8>> {
    let out = Command::new("reg").args(["query", key, "/s"]).output().ok()?;
    Some(out.stdout)
}

pub fn parse_fonts(text: &str) -> Vec<String> {
    let mut fonts = std::collections::BTreeSet::new();
    for line in text.lines() {
        // Lines look like: `    Cascadia Code (TrueType)    REG_SZ    cascadia.ttf`
        let marker = line
            .find(" REG_SZ ")
            .or_else(|| line.find(" REG_EXPAND_SZ "));
        let Some(idx) = marker else { continue };
        let name = line[..idx].trim();
        // Strip the trailing "(TrueType)" / "(OpenType)" / "(All res)" suffix.
        let clean = match name.rfind('(') {
            Some(open) if name.ends_with(')') => name[..open].trim(),
            _ => name,
        };
        if !clean.is_empty() {
            fonts.insert(clean.to_string());
        }
    }
    fonts.into_iter().collect()
}

static FONTS_CACHE: LazyLock<Mutex<Option<Vec<String>>>> = LazyLock::new(|| Mutex::new(None));

pub fn get_fonts() -> Result<Vec<String>, String> {
    let mut cache = FONTS_CACHE.lock().unwrap();
    if let Some(fonts) = cache.as_ref() {
        return Ok(fonts.clone());
    }

    let encoding = codepage_encoding();
    let hklm = scan_font_key(r"HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts");
    let hkcu = scan_font_key(r"HKCU\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts");
    // Partial success counts; only if both scans fail do we error (cache stays
    // empty so the next call retries).
    if hklm.is_none() && hkcu.is_none() {
        return Err("Font registry scan failed".into());
    }

    let mut all = Vec::new();
    for scan in [hklm, hkcu].into_iter().flatten() {
        let (text, _, _) = encoding.decode(&scan);
        all.extend(parse_fonts(&text));
    }
    all.sort();
    all.dedup();
    *cache = Some(all.clone());
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_fonts_extracts_and_dedupes() {
        let text = "\r\nHKLM\\Fonts\r\n    Cascadia Code (TrueType)    REG_SZ    cascadia.ttf\r\n    Consolas (TrueType)    REG_SZ    consola.ttf\r\n    Consolas (TrueType)    REG_SZ    consola.ttf\r\n    garbage line\r\n    SimSun (All res)    REG_SZ    simsun.ttc\r\n";
        let fonts = parse_fonts(text);
        assert_eq!(fonts, vec!["Cascadia Code", "Consolas", "SimSun"]);
    }

    #[test]
    fn parse_fonts_handles_expand_sz() {
        let text = "    Custom Font (OpenType)    REG_EXPAND_SZ    %PATH%\\font.otf\r\n";
        assert_eq!(parse_fonts(text), vec!["Custom Font"]);
    }
}
