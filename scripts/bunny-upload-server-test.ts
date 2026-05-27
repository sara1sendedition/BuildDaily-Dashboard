import assert from "node:assert/strict";
import {
  decodeImageBase64,
  resolveCarouselBunnyUrls,
  sanitizeUploadFilenamePrefix,
} from "../lib/storage/bunny-upload-server";

const tinyPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const decoded = decodeImageBase64(tinyPng);
assert.ok(decoded);
assert.equal(decoded!.contentType, "image/png");
assert.ok(decoded!.buffer.length > 0);

const dataUrl = decodeImageBase64(`data:image/png;base64,${tinyPng}`);
assert.ok(dataUrl);

assert.equal(decodeImageBase64(""), null);
assert.equal(decodeImageBase64("not-base64!!!"), null);

const prefix = sanitizeUploadFilenamePrefix("Grip Tips #4!", "abc12345-6789");
assert.match(prefix, /^grip-tips-4-abc12345$/);

void resolveCarouselBunnyUrls(
  { slideUrls: ["https://cdn.example/s1.png"] },
  undefined,
  { mode: "daemon", secret: "test" },
).then((mirror) => {
  assert.equal(mirror.ok, true);
  if (mirror.ok) {
    assert.deepEqual(mirror.data.slideUrlsInstagram, [
      "https://cdn.example/s1.png",
    ]);
  }
  console.log("bunny-upload-server-test: ok");
});
