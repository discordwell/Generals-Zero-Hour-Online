/**
 * Terrain data types and constants.
 *
 * These match the original engine's coordinate system and map format.
 * The original engine uses Z-up; Three.js uses Y-up, so the mapping is:
 *   Original X -> Three.js X
 *   Original Y -> Three.js Z
 *   Original Z -> Three.js Y
 */

// ============================================================================
// Map conversion constants (from HeightMapRenderObj / WorldHeightMap)
// ============================================================================

/** World units per heightmap grid cell (horizontal spacing). */
export const MAP_XY_FACTOR = 10.0;

/** Multiplier to convert raw 0–255 height values to world-space Y. */
export const MAP_HEIGHT_SCALE = MAP_XY_FACTOR / 16.0; // 0.625

/** Number of cells per terrain chunk edge (for frustum culling). */
export const CHUNK_SIZE = 32;

/** Minimum camera height above terrain surface. */
export const MIN_CAMERA_ALTITUDE = 20.0;

// ============================================================================
// Map JSON format (output of map-converter CLI)
// ============================================================================

/** Heightmap data as it appears in a converted map JSON file. */
export interface HeightmapDataJSON {
  /** Number of columns in the height grid. */
  width: number;
  /** Number of rows in the height grid. */
  height: number;
  /** Border/margin size in cells. */
  borderSize: number;
  /**
   * Source WorldHeightMap active-boundary extents in heightmap grid cells.
   * Boundary 0 is the default map extent used by W3DTerrainLogic::getExtent.
   */
  boundaries?: Array<{ x: number; y: number }>;
  /** Base64-encoded Uint8Array of raw height values (row-major, 0–255). */
  data: string;
}

/** A 3D point with x, y, z coordinates (in original engine space). */
export interface MapPoint {
  x: number;
  y: number;
  z: number;
}

/** Script parameter payload extracted from map script data. */
export interface ScriptParameterJSON {
  /** Numeric Script parameter type (Scripts.h Parameter::ParameterType). */
  type: number;
  /** Integer payload as stored in map script data. */
  intValue: number;
  /** Real payload as stored in map script data. */
  realValue: number;
  /** String payload as stored in map script data. */
  stringValue: string;
  /** Coordinate payload for COORD3D parameters. */
  coord?: MapPoint;
}

/** Script condition payload extracted from map script data. */
export interface ScriptConditionJSON {
  /** Numeric Script condition type (Scripts.h Condition::ConditionType). */
  conditionType: number;
  /** Ordered parameter list from the condition definition. */
  params: ScriptParameterJSON[];
}

/** Script action payload extracted from map script data. */
export interface ScriptActionJSON {
  /** Numeric Script action type (Scripts.h ScriptAction::ScriptActionType). */
  actionType: number;
  /** Ordered parameter list from the action definition. */
  params: ScriptParameterJSON[];
}

/** Script OR clause containing a list of AND conditions. */
export interface ScriptOrConditionJSON {
  conditions: ScriptConditionJSON[];
}

/** Script definition extracted from map script data. */
export interface ScriptJSON {
  name: string;
  comment: string;
  conditionComment: string;
  actionComment: string;
  active: boolean;
  oneShot: boolean;
  easy: boolean;
  normal: boolean;
  hard: boolean;
  subroutine: boolean;
  delayEvaluationSeconds: number;
  conditions: ScriptOrConditionJSON[];
  actions: ScriptActionJSON[];
  falseActions: ScriptActionJSON[];
}

/** Script group definition extracted from map script data. */
export interface ScriptGroupJSON {
  name: string;
  active: boolean;
  subroutine: boolean;
  scripts: ScriptJSON[];
}

/** Script list for a single side. */
export interface ScriptListJSON {
  scripts: ScriptJSON[];
  groups: ScriptGroupJSON[];
}

/** Build list entry extracted from a SidesList chunk. */
export interface MapSideBuildListEntryJSON {
  buildingName: string;
  templateName: string;
  location: MapPoint;
  angle: number;
  initiallyBuilt: boolean;
  numRebuilds: number;
  script?: string;
  health?: number;
  whiner?: boolean;
  unsellable?: boolean;
  repairable?: boolean;
}

/** Side entry extracted from a SidesList chunk. */
export interface MapSideJSON {
  /** Player dictionary extracted from the map (keys resolved to names). */
  dict: Record<string, unknown>;
  /** Build list entries for this side. */
  buildList: MapSideBuildListEntryJSON[];
  /** Script list associated with this side (if present). */
  scripts?: ScriptListJSON;
}

/** Team entry extracted from a SidesList chunk. */
export interface MapTeamJSON {
  /** Team dictionary extracted from the map (keys resolved to names). */
  dict: Record<string, unknown>;
}

/** Parsed SidesList data from a map. */
export interface MapSidesListJSON {
  sides: MapSideJSON[];
  teams: MapTeamJSON[];
}

/** A polygon trigger region from the map. */
export interface PolygonTriggerJSON {
  name: string;
  id: number;
  isWaterArea: boolean;
  isRiver: boolean;
  points: MapPoint[];
}

/** A placed object from the map. */
export interface MapObjectJSON {
  position: MapPoint;
  angle: number;
  templateName: string;
  flags: number;
  properties: Record<string, string>;
}

/** A waypoint node extracted from map object data. */
export interface WaypointNodeJSON {
  id: number;
  name: string;
  position: MapPoint;
  /** Route label used by map logic for path-based rail/transit selection. */
  pathLabel1?: string;
  /** Route label used by map logic for path-based rail/transit selection. */
  pathLabel2?: string;
  /** Route label used by map logic for path-based rail/transit selection. */
  pathLabel3?: string;
  /** Whether this waypoint adds reverse edges to its outgoing links. */
  biDirectional?: boolean;
}

/**
 * A directed waypoint link exported by map-converter.
 * Links are source-valid (nodes must exist), self-loops are removed, and
 * reverse links are emitted for bidirectional source waypoints.
 */
export interface WaypointLinkJSON {
  waypoint1: number;
  waypoint2: number;
}

/** Complete waypoint payload from map data. */
export interface WaypointDataJSON {
  nodes: WaypointNodeJSON[];
  /** Source-normalized, directed links after validity and directionality processing. */
  links: WaypointLinkJSON[];
}

/** A texture class definition from BlendTileData. */
export interface BlendTileTextureClass {
  /** Texture class name (e.g. "SandType3", "CliffLargeType10"). */
  name: string;
  /** First source tile index belonging to this class. */
  firstTile: number;
  /** Number of source tiles in this class. */
  numTiles: number;
}

/** Complete converted map JSON structure (matches map-converter output). */
export interface MapDataJSON {
  heightmap: HeightmapDataJSON;
  objects: MapObjectJSON[];
  triggers: PolygonTriggerJSON[];
  waypoints?: WaypointDataJSON;
  /** Texture classes used by the terrain blend system. String-only for legacy; object form preferred. */
  textureClasses: (string | BlendTileTextureClass)[];
  blendTileCount: number;
  /**
   * Optional base64-encoded Int16Array of per-cell tile indices.
   * Each cell maps to a source tile; the tile index determines which texture class applies.
   * Encoding: raw little-endian Int16 bytes -> base64.
   */
  tileIndices?: string;
  /**
   * Optional packed cliff-state bitset from BlendTileData (v7+), base64-encoded.
   * Bits are addressed by cell index using `cliffStateStride` bytes per row.
   */
  cliffStateData?: string;
  /**
   * Optional bytes-per-row for `cliffStateData`.
   * Mirrors engine `flipStateWidth` (typically ceil(heightmap.width / 8)).
   */
  cliffStateStride?: number;
  /** Optional SidesList payload containing sides, teams, and scripts. */
  sidesList?: MapSidesListJSON;
}

// ============================================================================
// Terrain configuration
// ============================================================================

/** Configuration for terrain rendering. */
export interface TerrainConfig {
  /** Enable wireframe overlay (toggled by F1). */
  wireframe: boolean;
  /** Enable vertex color height visualization. */
  vertexColors: boolean;
  /** Enable water surface rendering. */
  enableWater: boolean;
  /** Water surface opacity (0–1). */
  waterOpacity: number;
  /** Water surface color (hex). */
  waterColor: number;
}

/** Default terrain rendering configuration. */
export const DEFAULT_TERRAIN_CONFIG: Readonly<TerrainConfig> = {
  wireframe: false,
  vertexColors: true,
  enableWater: true,
  waterOpacity: 0.45,
  waterColor: 0x2266aa,
};
