export type MapViewport = { x: number; y: number; width: number; height: number };
export type MapPoint = readonly [number, number];

// Work in the existing projected map coordinates: changing the viewport never
// changes field geometry, interpolation, or laboratory results.
export function fitMapPoints(points: MapPoint[], aspect: number, padding = 0.08): MapViewport {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(maxX - minX, (maxY - minY) * aspect, 1) * (1 + padding * 2);
  const height = width / aspect;
  return { x: (minX + maxX - width) / 2, y: (minY + maxY - height) / 2, width, height };
}

export function constrainMapViewport(view: MapViewport, farm: MapViewport): MapViewport {
  const width = Math.min(farm.width, Math.max(farm.width / 32, view.width));
  const height = width * farm.height / farm.width;
  return {
    x: Math.max(farm.x, Math.min(farm.x + farm.width - width, view.x)),
    y: Math.max(farm.y, Math.min(farm.y + farm.height - height, view.y)),
    width,
    height,
  };
}

export function zoomMapViewport(view: MapViewport, farm: MapViewport, factor: number, anchor: MapPoint = [view.x + view.width / 2, view.y + view.height / 2]): MapViewport {
  const width = Math.min(farm.width, Math.max(farm.width / 32, view.width / factor));
  const ratio = width / view.width;
  return constrainMapViewport({
    x: anchor[0] - (anchor[0] - view.x) * ratio,
    y: anchor[1] - (anchor[1] - view.y) * ratio,
    width,
    height: view.height * ratio,
  }, farm);
}
