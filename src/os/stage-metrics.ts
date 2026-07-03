/** Read stage width/height with layout fallbacks for tests and early boot. */
export function getStageDimensions(stage: HTMLElement = document.getElementById('osStage') ?? document.body): {
  width: number;
  height: number;
} {
  const rect = stage.getBoundingClientRect();
  let width = rect.width || stage.clientWidth || stage.offsetWidth || 0;
  let height = rect.height || stage.clientHeight || stage.offsetHeight || 0;
  if (!width || !height) {
    width = width || Number.parseFloat(stage.style.width) || 0;
    height = height || Number.parseFloat(stage.style.height) || 0;
  }
  return { width, height };
}

/** Stage bounding rect with reliable width/height. */
export function getStageRect(stage: HTMLElement = document.getElementById('osStage') ?? document.body): DOMRect {
  const rect = stage.getBoundingClientRect();
  const { width, height } = getStageDimensions(stage);
  return { ...rect, width, height } as DOMRect;
}
