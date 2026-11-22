# Yogatik Browser — Improvement Session Log

**Date:** November 22, 2026
**Scope:** `yogatik-browser/` — Ad & Tracker Shield, Universal Video Controls, and Reader Mode enhancements
**Verification:** `node tests/run-tests.cjs` → 105 passed, 0 failed (17 node --check syntax validations + 5 settings-store + 27 page-pipeline + 29 chromium-privacy + 27 tab-lifecycle)

---

## 1. Ad & Anti-Adblock Shield (`electron/adBlocker.cjs`)

1. **YouTube Anti-Adblock Dialog Neutralizer**:
   - Modern YouTube displays enforcement overlays (`<ytd-enforcement-message-view-model>` and `<tp-yt-paper-dialog>`) warning that ad blockers violate terms of service, which freezes video playback.
   - The shield now actively detects and removes enforcement modals, tears down `<tp-yt-iron-overlay-backdrop>` modal backdrops, and automatically resumes video playback.
2. **Audio Un-Mute Restoration**:
   - The ad-skipper fast-forwards ads at 16× and mutes audio during ads. When the ad finishes, normal volume and 1.0× playback rate are restored automatically so the main video plays with sound.
3. **Modern Cosmetic Selector Expansion**:
   - Added selective cosmetic filters for sponsored posts (`.sponsored-post`, `[data-ad-slot]`, `[data-ad-unit]`, `ytd-in-feed-ad-layout-renderer`, `ytd-ad-break-service-renderer`, `.trc_related_container`, `.outbrain-ad`, `.taboola-ad`).

---

## 2. Universal Video Controls (`electron/videoControls.cjs`)

1. **One-Click Picture-in-Picture (`📺 PiP`)**:
   - Added a dedicated PiP button directly to the floating video pill.
   - Uses `document.pictureInPictureElement` and `requestPictureInPicture()` to pop any HTML5 video into a floating always-on-top window.
2. **Audio Volume Booster (1× / 1.5× / 2.0×)**:
   - Built with the Web Audio API (`AudioContext` + `createGain()`).
   - Boosts quiet videos, podcasts, and lectures beyond standard 100% volume limits without audio clipping.

---

## 3. Distraction-Free Reader Mode (`electron/readerMode.cjs`)

1. **Text-to-Speech (TTS) Narrator (`🔊 Listen`)**:
   - Built on the native Web Speech API (`window.speechSynthesis`).
   - Hands-free article narration with play/stop toggle. Automatically cancels speech synthesis when the reader mode overlay is exited.
2. **Executive Summary Card (`⚡ TL;DR`)**:
   - Added a one-click summary button that extracts key sentences from the article and inserts an executive summary card above the article body.
