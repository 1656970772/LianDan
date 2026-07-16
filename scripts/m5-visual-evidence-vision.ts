import type { Page } from '@playwright/test'

import type { M5VisualEvidenceVisionMode } from './m5-visual-evidence-support.ts'

const m5VisionTransformPreparedBrand = Symbol(
  'M5VisionTransformPreparedToken',
)

export type M5VisionTransformPreparedToken = Readonly<{
  readonly [m5VisionTransformPreparedBrand]: true
}>

type PreparedVisionTransform = Readonly<{
  page: Page
  visionMode: M5VisualEvidenceVisionMode
  colorMatrix: readonly number[]
  colorMatrixContent: string
}>

const preparedVisionTransforms = new WeakMap<object, PreparedVisionTransform>()

function colorMatrixContent(colorMatrix: readonly number[]): string {
  if (
    colorMatrix.length !== 20 ||
    !colorMatrix.every((value) => Number.isFinite(value))
  ) {
    throw new Error('M5_VISUAL_EVIDENCE_VISION_COLOR_MATRIX_INVALID')
  }
  return colorMatrix.join(' ')
}

export async function prepareM5VisualVisionTransform(
  page: Page,
  visionMode: M5VisualEvidenceVisionMode,
  colorMatrix: readonly number[],
): Promise<M5VisionTransformPreparedToken> {
  const matrixContent = colorMatrixContent(colorMatrix)
  await page.evaluate(`(() => {
    const matrix = ${JSON.stringify(colorMatrix)};
    const mode = ${JSON.stringify(visionMode)};
    const namespace = 'http://www.w3.org/2000/svg';
    const previous = document.getElementById('m5-evidence-vision-filter-root');
    if (previous) previous.remove();
    const app = document.getElementById('app');
    if (!app) throw new Error('M5_VISUAL_EVIDENCE_APP_ROOT_MISSING');
    app.style.removeProperty('filter');
    if (mode !== 'normal') {
      const svg = document.createElementNS(namespace, 'svg');
      svg.id = 'm5-evidence-vision-filter-root';
      svg.setAttribute('width', '0');
      svg.setAttribute('height', '0');
      svg.setAttribute('aria-hidden', 'true');
      svg.style.position = 'absolute';
      const filter = document.createElementNS(namespace, 'filter');
      filter.id = 'm5-evidence-vision-filter';
      filter.setAttribute('color-interpolation-filters', 'sRGB');
      const color = document.createElementNS(namespace, 'feColorMatrix');
      color.setAttribute('type', 'matrix');
      color.setAttribute('values', matrix.join(' '));
      filter.append(color);
      svg.append(filter);
      document.body.append(svg);
      app.style.filter = 'url(#m5-evidence-vision-filter)';
    }
    app.dataset.evidenceVisionMode = mode;
    app.dataset.evidenceColorMatrix = matrix.join(' ');
  })()`)
  await page.evaluate(
    `new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(true)))`,
  )
  const token: M5VisionTransformPreparedToken = Object.freeze({
    [m5VisionTransformPreparedBrand]: true,
  })
  preparedVisionTransforms.set(token, {
    page,
    visionMode,
    colorMatrix,
    colorMatrixContent: matrixContent,
  })
  return token
}

export function assertM5VisualVisionTransformPrepared(input: Readonly<{
  token: M5VisionTransformPreparedToken
  page: Page
  visionMode: M5VisualEvidenceVisionMode
  colorMatrix: readonly number[]
}>): void {
  const prepared = preparedVisionTransforms.get(input.token)
  if (
    prepared === undefined ||
    prepared.page !== input.page ||
    prepared.visionMode !== input.visionMode ||
    prepared.colorMatrix !== input.colorMatrix ||
    prepared.colorMatrixContent !== colorMatrixContent(input.colorMatrix)
  ) {
    throw new Error(
      'M5_VISUAL_EVIDENCE_TRANSIENT_VISION_TRANSFORM_NOT_PREPARED',
    )
  }
}
