/*
 * Captions of the images: the trailing dot is removed once, when the image is
 * inserted or its caption first set; captionTrimmed (data-caption-trimmed)
 * records it so that a dot typed back later is kept. The report generator
 * and the findings API apply the same rule (backend lib/markdown.js).
 */

// Caption of an image being inserted: one trailing dot removed (not an ellipsis)
export function trimCaption(caption) {
  return String(caption || "").replace(/\s+$/, "").replace(/([^.])\.$/, "$1");
}

// Attributes of a caption: the trailing dot is removed once, captionTrimmed
// records it so that a dot typed back later is kept
export function captionAttrs(caption, alreadyTrimmed) {
  const value = caption === null || caption === undefined ? "" : String(caption);
  if (alreadyTrimmed) return { alt: value, captionTrimmed: true };
  const trimmed = trimCaption(value);
  if (trimmed !== value.replace(/\s+$/, "")) return { alt: trimmed, captionTrimmed: true };
  return { alt: value, captionTrimmed: null };
}

