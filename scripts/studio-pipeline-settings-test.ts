import assert from "node:assert/strict";

import {
  applyLegacyAudioMigration,
  DEV_MODE_SHORT_AUDIO_MODE,
  PIPELINE_SETTINGS_SCHEMA_VERSION,
  STUDIO_SHORT_PIPELINE_DEFAULTS,
  resolveEffectiveStudioShortPipelineSettings,
} from "../lib/studio-short-pipeline-settings";
import { resolveShortAudioMode } from "../lib/video-to-short-proxy-form";

assert.equal(PIPELINE_SETTINGS_SCHEMA_VERSION, 3);
assert.equal(STUDIO_SHORT_PIPELINE_DEFAULTS.devMode, true);

const migrated = applyLegacyAudioMigration({
  ...STUDIO_SHORT_PIPELINE_DEFAULTS,
  audioMode: "gym",
});
assert.equal(migrated.audioMode, "deepfilter");

const kept = applyLegacyAudioMigration({
  ...STUDIO_SHORT_PIPELINE_DEFAULTS,
  audioMode: "original",
});
assert.equal(kept.audioMode, "original");

const devEffective = resolveEffectiveStudioShortPipelineSettings({
  ...STUDIO_SHORT_PIPELINE_DEFAULTS,
  audioMode: "deepfilter",
  devMode: true,
});
assert.equal(devEffective.audioMode, DEV_MODE_SHORT_AUDIO_MODE);

const prodEffective = resolveEffectiveStudioShortPipelineSettings({
  ...STUDIO_SHORT_PIPELINE_DEFAULTS,
  devMode: false,
});
assert.equal(prodEffective.audioMode, "deepfilter");

process.env.VIDEO_TO_SHORT_AUDIO_MODE = "deep-filter";
assert.equal(resolveShortAudioMode(null), "deepfilter");
delete process.env.VIDEO_TO_SHORT_AUDIO_MODE;

console.log("studio-pipeline-settings-test: ok");
