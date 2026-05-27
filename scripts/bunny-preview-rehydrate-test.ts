import assert from "node:assert/strict";
import {
  filterPreviewRehydratePatch,
  snapshotNeedsPreviewRehydrate,
  type PreviewRehydrateInput,
} from "../lib/storage/bunny-fetch-client";

function testNeedsRehydrate() {
  assert.equal(snapshotNeedsPreviewRehydrate(undefined), false);
  assert.equal(snapshotNeedsPreviewRehydrate({}), false);
  assert.equal(
    snapshotNeedsPreviewRehydrate({
      bunnyUrls: { slideUrls: ["https://cdn.example/s1.png"] },
      slidePreviewBase64s: null,
    }),
    true,
  );
  assert.equal(
    snapshotNeedsPreviewRehydrate({
      bunnyUrls: { slideUrls: ["https://cdn.example/s1.png"] },
      slidePreviewBase64s: ["abc"],
    }),
    false,
  );
  assert.equal(
    snapshotNeedsPreviewRehydrate({
      bunnyUrls: {
        slideUrlsInstagram: ["https://cdn.example/ig1.png"],
      },
      slidePreviewBase64s: ["abc"],
      slidePreviewBase64sInstagram: null,
    }),
    true,
  );
}

function testFilterPatch() {
  const patch = {
    slidePreviewBase64s: ["one"],
    firstSlidePreviewBase64: "one",
    slidePreviewBase64sInstagram: ["ig"],
    imagePost: {
      hook: "",
      microCta: "",
      caption: "cap",
      altText: "",
      evidenceSegmentIds: [],
      transcript: [],
      durationSec: 0,
      frameTimeSec: 0,
      imageBase64: "img",
    },
  };

  assert.equal(
    filterPreviewRehydratePatch(
      {
        slidePreviewBase64s: ["already"],
        slidePreviewBase64sInstagram: ["already-ig"],
        imagePost: { imageBase64: "already-img" } as PreviewRehydrateInput["imagePost"],
      },
      patch,
    ),
    null,
  );

  const partial = filterPreviewRehydratePatch(
    {
      slidePreviewBase64s: ["already"],
      slidePreviewBase64sInstagram: null,
    },
    patch,
  );
  assert.ok(partial);
  assert.deepEqual(partial?.slidePreviewBase64s, undefined);
  assert.deepEqual(partial?.slidePreviewBase64sInstagram, ["ig"]);

  const merged = filterPreviewRehydratePatch(
    {
      imagePost: {
        hook: "Forearms pump fast?",
        microCta: "3 cues below",
        caption: "Photo feed caption with steps.",
        altText: "Climbing tip overlay",
        evidenceSegmentIds: [2],
        transcript: [{ id: 0, text: "hi", startSec: 0, endSec: 1 }],
        durationSec: 12,
        frameTimeSec: 4,
        imageBase64: "",
      },
      socialCaption: "Carousel caption only",
    },
    patch,
  );
  assert.ok(merged?.imagePost);
  assert.equal(merged!.imagePost!.hook, "Forearms pump fast?");
  assert.equal(merged!.imagePost!.microCta, "3 cues below");
  assert.equal(
    merged!.imagePost!.caption,
    "Photo feed caption with steps.",
  );
  assert.equal(merged!.imagePost!.altText, "Climbing tip overlay");
  assert.equal(merged!.imagePost!.imageBase64, "img");
}

testNeedsRehydrate();
testFilterPatch();
console.log("bunny-preview-rehydrate-test: ok");
