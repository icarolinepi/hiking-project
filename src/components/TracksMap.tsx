"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type StyleSpecification,
  prewarm,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { TrackPayload } from "@/app/api/activities/tracks/route";
import {
  CARPATHIAN_BOUNDS,
  carpathianAreas,
  isCoordinateInArea,
  isCoordinateInCarpathians,
} from "@/data/carpathians";
import type { Summit } from "@/data/summits";
import { getSolarEvents } from "@/lib/solar";
import {
  prefetchFlightTiles,
  prefetchRouteStart,
} from "@/lib/prefetchTiles";

prewarm();

type TracksMapProps = {
  tracks: TrackPayload[];
  selectedId?: string | null;
  selectedArea?: string;
  terrainEnabled?: boolean;
  showAreas?: boolean;
  basemap?: "topo" | "satellite";
  conqueredSummits?: Summit[];
  compareMode?: boolean;
  myUserId?: string | null;
  onSelect?: (id: string | null) => void;
  onAreaSelect?: (name: string) => void;
};

const TERRAIN_EXAGGERATION = 1.35;
const SAFE_3D_PITCH = 56;
const FLIGHT_ZOOM = 16.1;

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    topo: {
      type: "raster",
      tiles: [
        "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://b.tile.opentopomap.org/{z}/{x}/{y}.png",
        "https://c.tile.opentopomap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 17,
      attribution:
        "Картографічні дані © OpenStreetMap, SRTM · стиль © OpenTopoMap (CC-BY-SA)",
    },
    satellite: {
      type: "raster",
      tiles: [
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      ],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        "Зображення © Esri, Maxar, Earthstar Geographics та GIS User Community",
    },
    terrain: {
      type: "raster-dem",
      tiles: [
        "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      maxzoom: 15,
      encoding: "terrarium",
    },
  },
  layers: [
    {
      id: "topo",
      type: "raster",
      source: "topo",
      paint: { "raster-fade-duration": 0 },
    },
    {
      id: "satellite",
      type: "raster",
      source: "satellite",
      layout: { visibility: "none" },
      paint: { "raster-fade-duration": 0 },
    },
    {
      id: "hillshade",
      type: "hillshade",
      source: "terrain",
      paint: {
        "hillshade-shadow-color": "#17251d",
        "hillshade-highlight-color": "#fff4cf",
        "hillshade-accent-color": "#4c684f",
        "hillshade-exaggeration": 0.35,
      },
    },
  ],
};

export function TracksMap({
  tracks,
  selectedId,
  selectedArea = "Усі масиви",
  terrainEnabled = true,
  showAreas = true,
  basemap = "topo",
  conqueredSummits = [],
  compareMode = false,
  myUserId = null,
  onSelect,
  onAreaSelect,
}: TracksMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const mapReadyRef = useRef(false);
  const areaMarkersRef = useRef<maplibregl.Marker[]>([]);
  const solarMarkersRef = useRef<maplibregl.Marker[]>([]);
  const summitMarkersRef = useRef<maplibregl.Marker[]>([]);
  const playbackMarkerRef = useRef<maplibregl.Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const playbackProgressRef = useRef(0);
  const smoothedBearingRef = useRef<number | null>(null);
  const selectedTrackRef = useRef<TrackPayload | null>(null);
  const isPlayingRef = useRef(false);
  const playbackSpeedRef = useRef(5);
  const onSelectRef = useRef(onSelect);
  const onAreaSelectRef = useRef(onAreaSelect);
  const showAreasRef = useRef(showAreas);
  const selectedAreaRef = useRef(selectedArea);
  const basemapRef = useRef(basemap);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(5);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  const carpathianTracks = useMemo(
    () => tracks.filter((track) => isCarpathianTrack(track.coordinates)),
    [tracks],
  );
  const selectedTrack = useMemo(
    () => carpathianTracks.find((track) => track.id === selectedId) ?? null,
    [carpathianTracks, selectedId],
  );

  useEffect(() => {
    onSelectRef.current = onSelect;
    onAreaSelectRef.current = onAreaSelect;
  }, [onAreaSelect, onSelect]);

  useEffect(() => {
    selectedTrackRef.current = selectedTrack;
  }, [selectedTrack]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    showAreasRef.current = showAreas;
  }, [showAreas]);

  useEffect(() => {
    selectedAreaRef.current = selectedArea;
  }, [selectedArea]);

  useEffect(() => {
    basemapRef.current = basemap;
  }, [basemap]);

  function applyAreasVisibility(map: MapLibreMap, visible: boolean) {
    const visibility = visible ? "visible" : "none";
    for (const layerId of ["area-fills", "area-lines", "carpathian-outline"]) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, "visibility", visibility);
      }
    }
    areaMarkersRef.current.forEach((marker) => {
      marker.getElement().style.display = visible ? "" : "none";
    });
  }

  function applyAreaSelection(
    map: MapLibreMap,
    areaName: string,
    visible: boolean,
  ) {
    if (!visible) {
      applyAreasVisibility(map, false);
      return;
    }

    applyAreasVisibility(map, true);

    if (areaName === "Усі масиви") {
      if (map.getLayer("area-fills")) {
        map.setFilter("area-fills", ["==", ["get", "parent"], false]);
      }
      if (map.getLayer("area-lines")) {
        map.setFilter("area-lines", ["==", ["get", "parent"], false]);
      }
      if (map.getLayer("carpathian-outline")) {
        map.setFilter("carpathian-outline", ["==", ["get", "parent"], true]);
        map.setLayoutProperty("carpathian-outline", "visibility", "visible");
      }
      areaMarkersRef.current.forEach((marker) => {
        marker.getElement().style.display = "";
      });
      return;
    }

    const areaFilter = [
      "all",
      ["==", ["get", "parent"], false],
      ["==", ["get", "name"], areaName],
    ] as maplibregl.FilterSpecification;
    if (map.getLayer("area-fills")) {
      map.setFilter("area-fills", areaFilter);
    }
    if (map.getLayer("area-lines")) {
      map.setFilter("area-lines", areaFilter);
    }
    if (map.getLayer("carpathian-outline")) {
      map.setLayoutProperty("carpathian-outline", "visibility", "none");
    }
    areaMarkersRef.current.forEach((marker) => {
      const isSelected = marker.getElement().textContent === areaName;
      marker.getElement().style.display = isSelected ? "" : "none";
    });
  }

  function applyBasemap(map: MapLibreMap, mode: "topo" | "satellite") {
    if (!map.getLayer("topo") || !map.getLayer("satellite")) return;
    map.setLayoutProperty(
      "topo",
      "visibility",
      mode === "topo" ? "visible" : "none",
    );
    map.setLayoutProperty(
      "satellite",
      "visibility",
      mode === "satellite" ? "visible" : "none",
    );
    if (map.getLayer("hillshade")) {
      map.setPaintProperty(
        "hillshade",
        "hillshade-exaggeration",
        mode === "satellite" ? 0.18 : 0.35,
      );
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      bounds: CARPATHIAN_BOUNDS,
      fitBoundsOptions: { padding: 44 },
      maxBounds: [
        [21.75, 47.35],
        [26.15, 50.0],
      ],
      pitch: SAFE_3D_PITCH,
      bearing: -11,
      maxPitch: 60,
      canvasContextAttributes: { antialias: true },
      attributionControl: false,
      maxTileCacheSize: 280,
      refreshExpiredTiles: true,
    });

    map.addControl(
      new maplibregl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
      }),
      "bottom-right",
    );
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      "bottom-right",
    );

    map.on("load", () => {
      map.setTerrain({ source: "terrain", exaggeration: TERRAIN_EXAGGERATION });
      map.addSource("carpathian-areas", {
        type: "geojson",
        data: carpathianAreas,
      });
      map.addLayer({
        id: "area-fills",
        type: "fill",
        source: "carpathian-areas",
        filter: ["==", ["get", "parent"], false],
        paint: {
          "fill-color": ["get", "color"],
          "fill-opacity": 0.16,
        },
      });
      map.addLayer({
        id: "area-lines",
        type: "line",
        source: "carpathian-areas",
        filter: ["==", ["get", "parent"], false],
        paint: {
          "line-color": ["get", "color"],
          "line-width": 2.8,
          "line-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "carpathian-outline",
        type: "line",
        source: "carpathian-areas",
        filter: ["==", ["get", "parent"], true],
        paint: {
          "line-color": "#ff6b3d",
          "line-width": 3,
          "line-opacity": 0.95,
        },
      });

      areaMarkersRef.current = carpathianAreas.features
        .filter((feature) => !feature.properties.parent)
        .map((feature) => {
          const element = document.createElement("button");
          element.type = "button";
          element.className = "area-map-label";
          element.textContent = feature.properties.name;
          element.style.setProperty("--area-color", feature.properties.color);
          element.addEventListener("click", () =>
            onAreaSelectRef.current?.(feature.properties.name),
          );

          return new maplibregl.Marker({
            element,
            anchor: "center",
            offset: getLabelOffset(feature.properties.name),
          })
            .setLngLat(getFeatureCenter(feature.geometry.coordinates[0]))
            .addTo(map);
        });

      map.addSource("tracks", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "track-glow",
        type: "line",
        source: "tracks",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#0a0600",
          "line-width": trackWidthByStack(
            [7.5, 4.2, 8, 5.5],
            [9, 5, 9, 6.5],
            [12.5, 6.5, 12, 9],
            [7.5, 3.6, 7, 5],
          ),
          "line-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            0.85,
            ["==", ["get", "stack"], "bottom"],
            0.7,
            0.55,
          ],
          "line-blur": 0.2,
        },
      });
      map.addLayer({
        id: "track-lines",
        type: "line",
        source: "tracks",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": ["get", "color"],
          "line-width": trackWidthByStack(
            [4.2, 2.0, 3.5, 2.4],
            [5.4, 2.5, 4.5, 3.2],
            [8.2, 3.8, 7, 5],
            [4.6, 2.1, 4, 2.8],
          ),
          "line-opacity": [
            "case",
            ["==", ["get", "selected"], true],
            1,
            ["==", ["get", "dimmed"], true],
            0.28,
            ["==", ["get", "stack"], "bottom"],
            0.92,
            ["==", ["get", "stack"], "top"],
            0.88,
            0.95,
          ],
        },
      });
      map.addLayer({
        id: "track-hit-area",
        type: "line",
        source: "tracks",
        paint: {
          "line-color": "#000000",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            16,
            12,
            24,
            15,
            16,
          ],
          "line-opacity": 0.01,
        },
      });
      map.addSource("playback-progress", {
        type: "geojson",
        data: emptyFeatureCollection(),
      });
      map.addLayer({
        id: "playback-progress",
        type: "line",
        source: "playback-progress",
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-color": "#ffe566",
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            6,
            18,
            12,
            8,
            15,
            5,
          ],
          "line-opacity": 1,
          "line-blur": 0.2,
        },
      });

      map.on("click", "track-hit-area", (event) => {
        const id = event.features?.[0]?.properties?.id;
        if (typeof id === "string") onSelectRef.current?.(id);
      });
      map.on("click", "area-fills", (event) => {
        const name = event.features?.[0]?.properties?.name;
        if (typeof name === "string") onAreaSelectRef.current?.(name);
      });
      map.on("mouseenter", "track-hit-area", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseenter", "area-fills", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "track-hit-area", () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("mouseleave", "area-fills", () => {
        map.getCanvas().style.cursor = "";
      });

      mapReadyRef.current = true;
      applyAreaSelection(
        map,
        selectedAreaRef.current,
        showAreasRef.current,
      );
      applyBasemap(map, basemapRef.current);
      map.resize();
    });

    mapRef.current = map;

    const resizeObserver = new ResizeObserver(() => {
      map.resize();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      stopAnimation();
      resizeObserver.disconnect();
      playbackMarkerRef.current?.remove();
      playbackMarkerRef.current = null;
      solarMarkersRef.current.forEach((marker) => marker.remove());
      solarMarkersRef.current = [];
      summitMarkersRef.current.forEach((marker) => marker.remove());
      summitMarkersRef.current = [];
      areaMarkersRef.current.forEach((marker) => marker.remove());
      areaMarkersRef.current = [];
      mapReadyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const source = map.getSource("tracks") as GeoJSONSource | undefined;
      const features: GeoJSON.Feature[] = [];

      const orderedTracks = compareMode
        ? [...carpathianTracks].sort((a, b) => {
            const aBottom = myUserId ? a.userId === myUserId : false;
            const bBottom = myUserId ? b.userId === myUserId : false;
            if (aBottom === bBottom) return 0;
            // спочатку нижній (товстий) шар, потім верхній (тонший)
            return aBottom ? -1 : 1;
          })
        : carpathianTracks;

      for (const track of orderedTracks) {
        const segments =
          selectedArea === "Усі масиви"
            ? [track.coordinates]
            : clipCoordinatesToArea(track.coordinates, selectedArea);

        const stack =
          compareMode && myUserId
            ? track.userId === myUserId
              ? "bottom"
              : "top"
            : "solo";

        for (const segment of segments) {
          if (segment.length < 2) continue;
          features.push({
            type: "Feature",
            properties: {
              id: track.id,
              name: track.name,
              type: track.type,
              athleteName: track.athleteName,
              color: track.color,
              stack,
              selected: selectedId === track.id,
              dimmed: Boolean(selectedId && selectedId !== track.id),
            },
            geometry: {
              type: "LineString",
              coordinates: segment.map(([lat, lng]) => [lng, lat]),
            },
          });
        }
      }

      source?.setData({
        type: "FeatureCollection",
        features,
      });
    };

    if (mapReadyRef.current || map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [carpathianTracks, selectedId, selectedArea, compareMode, myUserId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      summitMarkersRef.current.forEach((marker) => marker.remove());
      summitMarkersRef.current = conqueredSummits.map((summit) => {
        const element = document.createElement("div");
        element.className = "summit-marker";
        element.title = `${summit.name} · ${summit.elevationM} м`;
        element.innerHTML = `<span>▲</span><em>${summit.name}</em>`;
        return new maplibregl.Marker({ element, anchor: "bottom" })
          .setLngLat(toLngLat(summit.coordinate))
          .addTo(map);
      });
    };

    if (mapReadyRef.current || map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [conqueredSummits]);

  useEffect(() => {
    stopAnimation();
    playbackProgressRef.current = 0;
    queueMicrotask(() => {
      setIsPlaying(false);
      setPlaybackProgress(0);
    });

    const map = mapRef.current;
    if (!map) return;

    clearPlaybackVisuals(map);

    const track = selectedTrackRef.current;
    if (!track) return;

    ensurePlaybackMarker(map, track.coordinates[0]);
    solarMarkersRef.current = getSolarEvents(track)
      .filter((event) => event.coordinate)
      .map((event) => {
        const element = document.createElement("div");
        element.className = `solar-marker ${event.type}`;
        element.textContent = event.type === "sunrise" ? "🌅" : "🌇";
        element.title = `${event.label} під час походу`;
        return new maplibregl.Marker({ element, anchor: "center" })
          .setLngLat(toLngLat(event.coordinate!))
          .addTo(map);
      });

    prefetchRouteStart(track.coordinates, basemapRef.current, FLIGHT_ZOOM);
    fitToTrack(map, track);
  }, [selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyAreaSelection(map, selectedArea, showAreas);
  }, [selectedArea, showAreas]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyBasemap(map, basemap);
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      map.setTerrain(
        terrainEnabled
          ? { source: "terrain", exaggeration: TERRAIN_EXAGGERATION }
          : null,
      );
      map.easeTo({
        pitch: terrainEnabled ? SAFE_3D_PITCH : 0,
        duration: 700,
      });
    };

    if (mapReadyRef.current || map.isStyleLoaded()) update();
    else map.once("load", update);
  }, [terrainEnabled]);

  useEffect(() => {
    areaMarkersRef.current.forEach((marker) => {
      marker
        .getElement()
        .classList.toggle(
          "active",
          marker.getElement().textContent === selectedArea,
        );
    });

    if (selectedId) return;
    if (mapRef.current) resetMapToArea(mapRef.current, selectedArea);
  }, [selectedArea, selectedId]);

  function stopAnimation() {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }

  function ensurePlaybackMarker(
    map: MapLibreMap,
    coordinate: [number, number],
  ) {
    if (playbackMarkerRef.current) {
      playbackMarkerRef.current.setLngLat(toLngLat(coordinate));
      return playbackMarkerRef.current;
    }

    const playbackElement = document.createElement("div");
    playbackElement.className = "playback-marker";
    playbackElement.setAttribute("aria-label", "Поточна позиція на маршруті");
    playbackMarkerRef.current = new maplibregl.Marker({
      element: playbackElement,
      anchor: "center",
    })
      .setLngLat(toLngLat(coordinate))
      .addTo(map);

    return playbackMarkerRef.current;
  }

  function clearPlaybackVisuals(map: MapLibreMap) {
    playbackMarkerRef.current?.remove();
    playbackMarkerRef.current = null;
    smoothedBearingRef.current = null;
    solarMarkersRef.current.forEach((marker) => marker.remove());
    solarMarkersRef.current = [];
    const playbackSource = map.getSource(
      "playback-progress",
    ) as GeoJSONSource | undefined;
    playbackSource?.setData(emptyFeatureCollection());
  }

  function runPlaybackLoop() {
    const map = mapRef.current;
    const track = selectedTrackRef.current;
    if (!map || !track) return;

    const marker = ensurePlaybackMarker(map, track.coordinates[0]);
    const duration = 90_000 / playbackSpeedRef.current;
    const startedAt =
      performance.now() - playbackProgressRef.current * duration;
    let lastUiUpdate = 0;

    const tick = (now: number) => {
      if (!isPlayingRef.current) {
        animationFrameRef.current = null;
        return;
      }

      const progress = Math.min(1, (now - startedAt) / duration);
      playbackProgressRef.current = progress;
      updatePlaybackView(
        map,
        track,
        progress,
        marker,
        true,
        smoothedBearingRef,
        playbackSpeedRef.current,
      );

      if (now - lastUiUpdate > 50 || progress === 1) {
        lastUiUpdate = now;
        setPlaybackProgress(progress);
      }

      if (progress >= 1) {
        isPlayingRef.current = false;
        setIsPlaying(false);
        animationFrameRef.current = null;
        return;
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    stopAnimation();
    animationFrameRef.current = requestAnimationFrame(tick);
  }

  function togglePlayback() {
    const map = mapRef.current;
    const track = selectedTrackRef.current;
    if (!map || !track) return;

    if (isPlayingRef.current) {
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopAnimation();
      return;
    }

    if (playbackProgressRef.current >= 0.999) {
      playbackProgressRef.current = 0;
      setPlaybackProgress(0);
    }

    ensurePlaybackMarker(map, track.coordinates[0]);
    prefetchRouteStart(track.coordinates, basemapRef.current, FLIGHT_ZOOM);
    prefetchFlightTiles(
      track.coordinates,
      playbackProgressRef.current,
      Math.max(playbackSpeedRef.current, 8),
      basemapRef.current,
      FLIGHT_ZOOM,
    );
    isPlayingRef.current = true;
    setIsPlaying(true);
    runPlaybackLoop();
  }

  function seekPlayback(value: number) {
    const map = mapRef.current;
    const track = selectedTrackRef.current;
    if (!map || !track) return;

    isPlayingRef.current = false;
    setIsPlaying(false);
    stopAnimation();
    playbackProgressRef.current = value;
    setPlaybackProgress(value);
    const marker = ensurePlaybackMarker(map, track.coordinates[0]);
    updatePlaybackView(
      map,
      track,
      value,
      marker,
      false,
      smoothedBearingRef,
      playbackSpeedRef.current,
    );
  }

  function changeSpeed(speed: number) {
    setPlaybackSpeed(speed);
    playbackSpeedRef.current = speed;
    if (isPlayingRef.current) {
      runPlaybackLoop();
    }
  }

  return (
    <div className="map-stage">
      <div ref={containerRef} className="tracks-map" />
      {selectedTrack ? (
        <div className="route-player">
          <button
            type="button"
            className="player-play"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Призупинити політ" : "Запустити політ"}
          >
            {isPlaying ? "Ⅱ" : "▶"}
          </button>
          <label className="player-progress">
            <span>Політ маршрутом</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={playbackProgress}
              onChange={(event) => seekPlayback(Number(event.target.value))}
            />
          </label>
          <label className="player-speed">
            <span>Швидкість</span>
            <select
              value={playbackSpeed}
              onChange={(event) => changeSpeed(Number(event.target.value))}
            >
              {[1, 2, 5, 10, 20].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}

function emptyFeatureCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function isCarpathianTrack(coordinates: [number, number][]) {
  return coordinates.some(isCoordinateInCarpathians);
}

function getFeatureCenter(ring: GeoJSON.Position[]): [number, number] {
  const bounds = ring.reduce(
    (current, coordinate) => current.extend(coordinate as [number, number]),
    new maplibregl.LngLatBounds(
      ring[0] as [number, number],
      ring[0] as [number, number],
    ),
  );
  const center = bounds.getCenter();
  return [center.lng, center.lat];
}

function getLabelOffset(name: string): [number, number] {
  const offsets: Record<string, [number, number]> = {
    Чорногора: [52, -24],
    "Мармароський масив": [-58, 22],
    Свидівець: [-44, -24],
    "Чивчинські гори": [56, 24],
    "Гринявські гори": [48, -20],
  };
  return offsets[name] ?? [0, 0];
}

function resetMapToArea(map: MapLibreMap, selectedArea: string) {
  if (selectedArea === "Усі масиви") {
    map.fitBounds(CARPATHIAN_BOUNDS, {
      padding: 44,
      duration: 900,
    });
    return;
  }

  const feature = carpathianAreas.features.find(
    (item) => item.properties.name === selectedArea,
  );
  const ring = feature?.geometry.coordinates[0];
  if (!ring?.length) return;

  const bounds = ring.reduce(
    (current, coordinate) => current.extend(coordinate as [number, number]),
    new maplibregl.LngLatBounds(
      ring[0] as [number, number],
      ring[0] as [number, number],
    ),
  );
  map.fitBounds(bounds, { padding: 72, duration: 900 });
}

function fitToTrack(map: MapLibreMap, track: TrackPayload) {
  const routeBounds = track.coordinates.reduce(
    (bounds, [latitude, longitude]) => bounds.extend([longitude, latitude]),
    new maplibregl.LngLatBounds(
      [track.coordinates[0][1], track.coordinates[0][0]],
      [track.coordinates[0][1], track.coordinates[0][0]],
    ),
  );

  const isMobile = window.innerWidth <= 720;
  map.fitBounds(routeBounds, {
    padding: isMobile
      ? { top: 24, right: 24, bottom: 24, left: 24 }
      : { top: 64, right: 64, bottom: 64, left: 390 },
    maxZoom: 14,
    duration: 900,
  });
}

function toLngLat([latitude, longitude]: [number, number]): [number, number] {
  return [longitude, latitude];
}

/**
 * Ширина лінії з урахуванням шару порівняння:
 * bottom (ти) — жирніша знизу, top (друг) — тонша зверху.
 * Кортеж на зум: [bottom, top, soloSelected, solo].
 */
function trackWidthByStack(
  atZoom6: [number, number, number, number],
  atZoom9: [number, number, number, number],
  atZoom12: [number, number, number, number],
  atZoom15: [number, number, number, number],
): maplibregl.ExpressionSpecification {
  const widthAt = ([
    bottom,
    top,
    soloSelected,
    solo,
  ]: [number, number, number, number]): maplibregl.ExpressionSpecification => [
    "case",
    ["==", ["get", "stack"], "bottom"],
    [
      "case",
      ["==", ["get", "selected"], true],
      Math.round(bottom * 1.15 * 10) / 10,
      bottom,
    ],
    ["==", ["get", "stack"], "top"],
    [
      "case",
      ["==", ["get", "selected"], true],
      Math.round(top * 1.25 * 10) / 10,
      top,
    ],
    ["case", ["==", ["get", "selected"], true], soloSelected, solo],
  ];

  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    6,
    widthAt(atZoom6),
    9,
    widthAt(atZoom9),
    12,
    widthAt(atZoom12),
    15,
    widthAt(atZoom15),
  ];
}

/** Розбиває трек на сегменти, що лежать всередині вибраного масиву. */
function clipCoordinatesToArea(
  coordinates: [number, number][],
  areaName: string,
): [number, number][][] {
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];

  for (const coordinate of coordinates) {
    if (isCoordinateInArea(areaName, coordinate)) {
      current.push(coordinate);
      continue;
    }
    if (current.length >= 2) segments.push(current);
    current = [];
  }

  if (current.length >= 2) segments.push(current);
  return segments;
}

function updatePlaybackView(
  map: MapLibreMap,
  track: TrackPayload,
  progress: number,
  marker: maplibregl.Marker,
  followCamera: boolean,
  smoothedBearingRef: { current: number | null },
  playbackSpeed: number,
) {
  const point = interpolateTrackPoint(track.coordinates, progress);
  const lngLat = toLngLat(point);
  marker.setLngLat(lngLat);

  const source = map.getSource("playback-progress") as GeoJSONSource | undefined;
  const lastIndex = Math.max(
    0,
    Math.floor(progress * (track.coordinates.length - 1)),
  );
  source?.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: [
            ...track.coordinates.slice(0, lastIndex + 1).map(toLngLat),
            lngLat,
          ],
        },
      },
    ],
  });

  const targetBearing = bearingAlongRoute(track.coordinates, progress);
  if (!followCamera || smoothedBearingRef.current === null) {
    smoothedBearingRef.current = targetBearing;
  } else {
    smoothedBearingRef.current = easeBearing(
      smoothedBearingRef.current,
      targetBearing,
      playbackSpeed,
    );
  }

  if (followCamera) {
    followFlightCamera(map, point, smoothedBearingRef.current);
    prefetchFlightTiles(
      track.coordinates,
      progress,
      playbackSpeed,
      basemapFromMap(map),
      FLIGHT_ZOOM,
    );
  }
}

function basemapFromMap(map: MapLibreMap): "topo" | "satellite" {
  const visibility = map.getLayoutProperty("satellite", "visibility");
  return visibility === "visible" ? "satellite" : "topo";
}

function followFlightCamera(
  map: MapLibreMap,
  point: [number, number],
  bearing: number,
) {
  // Keep the traveler locked in frame; only heading is smoothed separately.
  const center = toLngLat(point);
  const elevation = map.queryTerrainElevation(center);

  map.stop();
  map.jumpTo({
    center,
    ...(elevation != null ? { elevation } : {}),
    zoom: FLIGHT_ZOOM,
    pitch: SAFE_3D_PITCH,
    bearing,
  });
}

function interpolateTrackPoint(
  coordinates: [number, number][],
  progress: number,
): [number, number] {
  const exactIndex = Math.max(
    0,
    Math.min(coordinates.length - 1, progress * (coordinates.length - 1)),
  );
  const startIndex = Math.floor(exactIndex);
  const endIndex = Math.min(coordinates.length - 1, startIndex + 1);
  const fraction = exactIndex - startIndex;
  const start = coordinates[startIndex];
  const end = coordinates[endIndex];
  return [
    start[0] + (end[0] - start[0]) * fraction,
    start[1] + (end[1] - start[1]) * fraction,
  ];
}

function bearingAlongRoute(
  coordinates: [number, number][],
  progress: number,
) {
  // Very long look-ahead: follow the trail corridor, not local GPS noise.
  const samples = [450, 800, 1300].map((meters) =>
    bearingAtDistance(coordinates, progress, meters),
  );
  return circularMeanDegrees(samples);
}

function bearingAtDistance(
  coordinates: [number, number][],
  progress: number,
  minDistanceM: number,
) {
  const origin = interpolateTrackPoint(coordinates, progress);
  const startIndex = Math.floor(progress * (coordinates.length - 1));
  let traveled = 0;
  let previous = origin;

  for (let i = startIndex + 1; i < coordinates.length; i += 1) {
    const next = coordinates[i];
    traveled += haversineMeters(previous, next);
    previous = next;
    if (traveled >= minDistanceM) {
      return calculateBearing(origin, next);
    }
  }

  const end = coordinates[coordinates.length - 1];
  if (origin[0] === end[0] && origin[1] === end[1]) {
    if (startIndex > 0) {
      return calculateBearing(coordinates[startIndex - 1], end);
    }
    return 0;
  }
  return calculateBearing(origin, end);
}

function haversineMeters(
  [lat1, lng1]: [number, number],
  [lat2, lng2]: [number, number],
) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

function circularMeanDegrees(angles: number[]) {
  let x = 0;
  let y = 0;
  for (const angle of angles) {
    const radians = (angle * Math.PI) / 180;
    x += Math.cos(radians);
    y += Math.sin(radians);
  }
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function easeBearing(current: number, target: number, playbackSpeed: number) {
  const delta = ((target - current + 540) % 360) - 180;
  // Very slow turns — camera barely yaws while still eventually aligning.
  const alpha = 0.004;
  const maxDegPerFrame = Math.min(0.12, 0.07 + playbackSpeed * 0.004);
  const stepped = delta * alpha;
  if (Math.abs(stepped) <= maxDegPerFrame) {
    return current + stepped;
  }
  return current + Math.sign(delta) * maxDegPerFrame;
}

function calculateBearing(
  [startLat, startLng]: [number, number],
  [endLat, endLng]: [number, number],
) {
  const startLatitude = (startLat * Math.PI) / 180;
  const endLatitude = (endLat * Math.PI) / 180;
  const longitudeDelta = ((endLng - startLng) * Math.PI) / 180;
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(endLatitude) -
    Math.sin(startLatitude) *
      Math.cos(endLatitude) *
      Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180) / Math.PI;
}
