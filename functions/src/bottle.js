export function buildBottlePrompt(spec) {
  const facts = [spec.name, spec.category && `type: ${spec.category}`, spec.brand && `brand: ${spec.brand}`]
    .filter(Boolean)
    .join(', ')
  return `Create a square editorial studio photograph of one upright alcoholic bottle on warm neutral paper. The bottle should be a believable ${facts}. Preserve the recognizable bottle silhouette and label hierarchy, but do not add unrelated bottles, glasses, fruit, hands, text overlays, or props. Soft directional light, restrained shadows, premium cocktail-bar catalog photography, centered composition, full bottle visible.`
}
