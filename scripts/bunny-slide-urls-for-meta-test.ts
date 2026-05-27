import assert from "node:assert/strict";
import { bunnySlideUrlsForMetaPublish } from "../lib/schedule/slides-for-meta-from-snapshot";

const bunnyUrls = {
  slideUrls: ["https://cdn.example/s1.png", "https://cdn.example/s2.png"],
  slideUrlsInstagram: ["https://cdn.example/ig1.png"],
  imagePostUrl: "https://cdn.example/photo.jpg",
};

assert.deepEqual(
  bunnySlideUrlsForMetaPublish(bunnyUrls, true, true, "carousel"),
  ["https://cdn.example/ig1.png"],
  "carousel kind prefers slide URLs",
);

assert.deepEqual(
  bunnySlideUrlsForMetaPublish(bunnyUrls, true, true, "photo"),
  ["https://cdn.example/photo.jpg"],
  "photo kind uses imagePostUrl even when carousel slides exist",
);

assert.equal(
  bunnySlideUrlsForMetaPublish(
    { slideUrls: ["https://cdn.example/s1.png"] },
    true,
    true,
    "photo",
  ),
  undefined,
  "photo kind does not fall back to carousel slides",
);

assert.deepEqual(
  bunnySlideUrlsForMetaPublish(
    { imagePostUrl: "https://cdn.example/photo.jpg" },
    true,
    true,
    "carousel",
  ),
  ["https://cdn.example/photo.jpg"],
  "carousel kind may fall back to imagePostUrl when no slides",
);

console.log("bunny-slide-urls-for-meta-test: ok");
