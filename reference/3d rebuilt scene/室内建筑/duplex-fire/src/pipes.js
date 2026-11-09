// Pipes drawn thicker than they are.
//
// Most pipes here are 2-4 cm across. Seen across the whole house that is
// about a pixel, and with the walls see-through Billy could not find them at
// all. Each straight run is drawn fatter about its own axis, to DRAW_DIAMETER,
// keeping its length; fittings (elbows, tees) swell about their centre by the
// same factor, so joints stay closed. Pipes already that thick are left alone.
//
// Drawing only: the element boxes in meta, and anything worked out from them,
// keep the real sizes.
export const DRAW_DIAMETER = 0.1;   // metres; not to scale

/** Fatten the pipes and fittings of one layer from readLayer, in place. */
export function thickenPipes(layer) {
  const pos = layer.geometry.attributes.position;
  for (const mesh of layer.elements) {
    const e = mesh.userData.element;
    const segment = e.type === 'IfcFlowSegment';
    if (!segment && e.type !== 'IfcFlowFitting') continue;   // devices keep their size
    const size = [0, 1, 2].map((a) => e.max[a] - e.min[a]);
    const centre = [0, 1, 2].map((a) => (e.min[a] + e.max[a]) / 2);
    const sorted = [...size].sort((a, b) => a - b);
    const across = sorted[0];
    if (!(across > 0) || across >= DRAW_DIAMETER) continue;
    const k = DRAW_DIAMETER / across;
    const axis = size.indexOf(sorted[2]);
    // A straight run lies along one axis (Revit draws them that way; drains
    // slope by a percent or two). One that doesn't is left as it is: scaling
    // it whole would also make it k times longer.
    const straight = sorted[2] > 2 * sorted[1];
    if (segment && !straight) continue;
    const done = new Set();
    for (const i of mesh.geometry.index.array) {
      if (done.has(i)) continue;
      done.add(i);
      for (let a = 0; a < 3; a++) {
        if (segment && a === axis) continue;
        pos.setComponent(i, a, centre[a] + (pos.getComponent(i, a) - centre[a]) * k);
      }
    }
  }
  pos.needsUpdate = true;
  layer.geometry.computeVertexNormals();
  layer.geometry.computeBoundingSphere();
}
