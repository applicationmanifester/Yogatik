# Yogatik Internal Technical Debt Register

_Last reviewed: 2 Oct 2026._

## Critical (P0) - Address in next 2 sprints
1. ~~**LiveHudOverlay removal residue**~~ **RESOLVED / STALE.** `LiveView.jsx` no longer imports or renders `LiveHudOverlay`; the component was retired to a stub (see `CLAUDE.md` line 229). A workspace-wide search confirms the only surviving references are explanatory comments in `buildGuards.test.js`. No re-render or leak path remains — safe to strike.
2. ~~**ChromeAI tool visibility bug fix verification**~~ **RESOLVED.** Automated test in `agent.test.js:485` verifies tool descriptions appear in messages[0] for prompted mode from start, ensuring local providers (chromeai, WebLLM) receive full tool contracts.
3. ~~**Object detection overlay performance**~~ **DONE (2 Oct 2026).** DETR/CLIP no longer receive the full-resolution live frame. `vision/detect.js` now downscales every image to a <=320px long edge (`INFERENCE_MAX_EDGE`, `fitInferenceDimensions`, `downscaleForInference`) before inference; boxes are percentage-based so positions still map to the full frame, and the helper is fail-safe (anything it cannot decode passes through untouched). Covered by 13 new assertions in `vision/detect.test.js`.

## High (P1) - Address in next 3 sprints
1. **Reflex Prefetch whitelist expansion** *(Partially resolved 25 Nov 2026)* - Added `currency` conversion and `inch`/`inches` unit aliases to `agentReflex.js` (`REFLEX_WHITELIST` + `detectCurrency`); basic factual queries remain deferred.
2. **Browser download security** *(Partially resolved 25 Nov 2026)* - `wait_for_download` in `browserControl.js` now validates file extensions, browser `dangerType`, and `scanResult` via `validateDownloadedFile`, withholding `fs_read` recommendations and surfacing `securityWarning` for executables/scripts. Native AV/virus scanner integration in the Electron main process remains open.
3. **Live voice engine switch latency** - Switching between Neural/System engines causes audible glitch; implement crossfade or buffer to prevent audio artifacts.

## Medium (P2) - Address in next 4 sprints
1. ~~**Agent canary leak detection eviction policy**~~ **RESOLVED (25 Nov 2026).** `ACTIVE_CANARIES` in `tools/guardrails.js` now enforces byte-size-aware (`MAX_CANARIES_BYTES`), count (`MAX_CANARIES`), and 24h TTL (`CANARY_TTL_MS`) eviction plus LRU refresh on `checkCanaryLeak` hits.
2. ~~**Temporal buffer lifecycle**~~ **RESOLVED (24 Nov 2026).** `temporalVideoBuffer.clear()` is now invoked on unmount and `handleEnd` in `LiveView.jsx`, ensuring no stale frames linger between Live video sessions.
3. ~~**Electron build script duplication**~~ **RESOLVED (25 Nov 2026).** Extracted shared logic from `build-electron.bat` and `build-studio.bat` into `scripts/build-win-common.bat`.

## Low (P3) - Address as time permits
1. **CSS class deduplication** - Multiple files define similar LS-select and style-select classes; consolidate into shared CSS module.
2. **Commented-out code in vision/detect.js** - Remove obsolete DETR confidence threshold experiments.
3. **Logging inconsistency** - Mix of console.log and logError; standardize on structured logging with levels.
