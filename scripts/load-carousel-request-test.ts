import assert from "node:assert/strict";
import {
  parseLoadCarouselRequest,
  parsePublishAtUnix,
} from "../lib/schedule/load-carousel-request";

assert.equal(parsePublishAtUnix(1779871200), 1779871200);
assert.equal(parsePublishAtUnix(1779871200000), 1779871200);
assert.ok(parsePublishAtUnix("2026-05-26T14:00:00.000Z")! > 0);

const single = parseLoadCarouselRequest({
  publishAt: "2026-05-26T14:00:00.000Z",
  caption: "Test caption",
  videoLabel: "Week 1",
  slideUrls: ["https://cdn.example/a.png"],
});
assert.equal(single.ok, true);
if (single.ok) {
  assert.equal(single.items.length, 1);
  assert.equal(single.items[0]!.row.scheduleKind, "carousel");
  assert.equal(single.items[0]!.row.bunnyUrls?.slideUrls?.[0], "https://cdn.example/a.png");
}

const batch = parseLoadCarouselRequest({
  carousels: [
    {
      publishAt: 1779871200,
      caption: "One",
      videoLabel: "A",
      slideUrls: ["https://cdn.example/1.png"],
    },
    {
      publishAt: 1779957600,
      caption: "Two",
      videoLabel: "B",
      slideUrls: ["https://cdn.example/2.png", "https://cdn.example/3.png"],
      slideUrlsInstagram: ["https://cdn.example/ig.png"],
      postToInstagram: false,
    },
  ],
});
assert.equal(batch.ok, true);
if (batch.ok) {
  assert.equal(batch.items.length, 2);
  assert.equal(batch.items[1]!.row.postToInstagram, false);
  assert.equal(batch.items[1]!.row.slideCount, 2);
}

const bad = parseLoadCarouselRequest({ carousels: [] });
assert.equal(bad.ok, false);

const base64Only = parseLoadCarouselRequest({
  publishAt: "2026-05-26T14:00:00.000Z",
  caption: "Base64 carousel",
  videoLabel: "Week 3",
  slidesBase64: ["iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="],
});
assert.equal(base64Only.ok, true);
if (base64Only.ok) {
  assert.equal(base64Only.items[0]!.pendingUpload?.slidesBase64?.length, 1);
  assert.equal(base64Only.items[0]!.row.bunnyUrls?.slideUrls, undefined);
}

const noSlides = parseLoadCarouselRequest({
  publishAt: "2026-05-26T14:00:00.000Z",
  caption: "Missing slides",
  videoLabel: "Bad",
});
assert.equal(noSlides.ok, false);

const emptyBatchWithPublishAt = parseLoadCarouselRequest({
  carousels: [],
  publishAt: "2026-05-26T14:00:00.000Z",
  caption: "Fallback single",
  videoLabel: "Week 2",
  slideUrls: ["https://cdn.example/b.png"],
});
assert.equal(emptyBatchWithPublishAt.ok, true);

console.log("load-carousel-request-test: ok");
