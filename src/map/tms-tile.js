// Guarded IEM tile layer.
//
// IEM's tile.py renders a red "Invalid TMS Request :(" PNG and serves it as a
// normal HTTP 200 whenever a tile request has non-finite coordinates. Leaflet
// can momentarily emit NaN {z}/{x}/{y} when the map's zoom or center is
// transiently invalid — a degenerate fitBounds, a zero-sized container during
// invalidateSize, or mid-transition. A plain L.tileLayer then paints that red
// error tile verbatim across the whole map (the "orange tiled message" bug).
//
// This subclass refuses to build a URL for non-finite coordinates, serving a
// transparent pixel instead. It never hits the network with a bad request, and
// it self-heals: once the map settles, Leaflet re-requests at valid coords and
// the real imagery loads. Use it for any layer that paints IEM tiles verbatim
// (satellite, velocity) — recolored pipelines (radar/rainfall) guard in their
// own createTile.
import L from 'leaflet';

// 1×1 transparent GIF.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export const SafeTmsLayer = L.TileLayer.extend({
  getTileUrl(coords) {
    const z = this._getZoomForUrl();
    if (!Number.isFinite(coords.x) || !Number.isFinite(coords.y) || !Number.isFinite(z)) {
      return BLANK;
    }
    return L.TileLayer.prototype.getTileUrl.call(this, coords);
  },
});

export const safeTmsLayer = (url, options) => new SafeTmsLayer(url, options);
