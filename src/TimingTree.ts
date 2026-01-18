/**
 * Hierarchical Timing Tree
 * 
 * Replaces global variables with a nested structure indexed by:
 * layer → section → phrase → measure → beat → division → subdivision → subsubdivision
 * 
 * Provides complete timing history and per-layer isolation without globals.
 */

export interface TimingLeaf {
  // Position indices
  index?: number;
  
  // Tick-based timing
  start?: number;
  end?: number;
  duration?: number;
  
  // Time-based timing (seconds)
  startTime?: number;
  endTime?: number;
  durationTime?: number;
  
  // Duration values (ticks per unit)
  tp?: number;  // ticks per
  sp?: number;  // seconds per
  
  // Rhythm
  rhythm?: number[];
  
  // Unit-specific metadata
  unitsPerParent?: number;
  composer?: any;
  meter?: [number, number];
  actualMeter?: [number, number];
  midiMeter?: [number, number];
  meterRatio?: number;
  midiMeterRatio?: number;
  syncFactor?: number;
  midiBPM?: number;
  tpSec?: number;
  polyNumerator?: number;
  polyDenominator?: number;
  polyMeterRatio?: number;
  measuresPerPhrase?: number;
  divsPerBeat?: number;
  subdivsPerDiv?: number;
  subsubdivsPerSub?: number;
  
  // Rhythm tracking
  beatsOn?: number;
  beatsOff?: number;
  divsOn?: number;
  divsOff?: number;
  subdivsOn?: number;
  subdivsOff?: number;
  
  // BPM/timing ratios
  trueBPM?: number;
  bpmRatio?: number;
  bpmRatio2?: number;
  bpmRatio3?: number;
  
  // Child nodes
  children?: Record<string, TimingLeaf>;
  
  [key: string]: any;
}

export interface TimingTree {
  [layer: string]: TimingLeaf;
}

/**
 * Initialize or get timing tree from context
 */
export const initTimingTree = (ctx: any): TimingTree => {
  if (!ctx.state) ctx.state = {};
  if (!ctx.state.timingTree) {
    ctx.state.timingTree = {};
  }
  return ctx.state.timingTree;
};

/**
 * Get or create a path in the tree for a specific layer/section/phrase/etc
 * 
 * Path format: "layer/section/0/phrase/0/measure/0/beat/0"
 */
export const getOrCreatePath = (tree: TimingTree, path: string): TimingLeaf => {
  const parts = path.split('/');
  let current: any = tree;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!current.children) {
      current.children = {};
    }
    if (!current.children[part]) {
      current.children[part] = {};
    }
    current = current.children[part];
  }
  
  return current;
};

/**
 * Build path string from layer/section/phrase/measure/beat/etc indices
 */
export const buildPath = (layer: string, section: number, phrase?: number, measure?: number, beat?: number, div?: number, subdiv?: number, subsubdiv?: number): string => {
  let path = layer;
  if (section !== undefined) path += `/section/${section}`;
  if (phrase !== undefined) path += `/phrase/${phrase}`;
  if (measure !== undefined) path += `/measure/${measure}`;
  if (beat !== undefined) path += `/beat/${beat}`;
  if (div !== undefined) path += `/division/${div}`;
  if (subdiv !== undefined) path += `/subdivision/${subdiv}`;
  if (subsubdiv !== undefined) path += `/subsubdivision/${subsubdiv}`;
  return path;
};

/**
 * Set a timing value at a specific path
 */
export const setTimingValue = (tree: TimingTree, path: string, key: string, value: any): void => {
  const node = getOrCreatePath(tree, path);
  node[key] = value;
};

/**
 * Get a timing value at a specific path
 */
export const getTimingValue = (tree: TimingTree, path: string, key: string, defaultValue?: any): any => {
  const parts = path.split('/');
  let current: any = tree;
  
  for (const part of parts) {
    if (!current.children || !current.children[part]) {
      return defaultValue;
    }
    current = current.children[part];
  }
  
  return current[key] ?? defaultValue;
};

/**
 * Set multiple timing values at once
 */
export const setTimingValues = (tree: TimingTree, path: string, values: Record<string, any>): void => {
  const node = getOrCreatePath(tree, path);
  Object.assign(node, values);
};

/**
 * Get all timing values at a specific path
 */
export const getTimingValues = (tree: TimingTree, path: string): TimingLeaf | undefined => {
  const parts = path.split('/');
  let current: any = tree;
  
  for (const part of parts) {
    if (!current.children || !current.children[part]) {
      return undefined;
    }
    current = current.children[part];
  }
  
  return current;
};

/**
 * Create a new layer in the tree
 */
export const initLayer = (tree: TimingTree, layer: string): void => {
  if (!tree[layer]) {
    tree[layer] = {};
  }
};

/**
 * Copy timing values from globals to tree (for backward compat during migration)
 */
export const syncGlobalsToTree = (tree: TimingTree, path: string, globals: any): void => {
  const timingKeys = [
    'tpSec', 'tpSection', 'spSection',
    'tpPhrase', 'spPhrase',
    'tpMeasure', 'spMeasure',
    'tpBeat', 'spBeat',
    'tpDiv', 'spDiv',
    'tpSubdiv', 'spSubdiv',
    'tpSubsubdiv', 'spSubsubdiv',
    'beatStart', 'beatStartTime',
    'measureStart', 'measureStartTime',
    'phraseStart', 'phraseStartTime',
    'divStart', 'divStartTime',
    'subdivStart', 'subdivStartTime',
    'subsubdivStart', 'subsubdivStartTime',
    'sectionStart', 'sectionStartTime',
    'numerator', 'denominator',
    'midiMeter', 'meterRatio', 'midiMeterRatio', 'syncFactor', 'midiBPM',
    'polyNumerator', 'polyDenominator', 'polyMeterRatio',
    'divsPerBeat', 'subdivsPerDiv', 'subsubdivsPerSub',
    'measuresPerPhrase', 'measuresPerPhrase1', 'measuresPerPhrase2',
    'beatRhythm', 'divRhythm', 'subdivRhythm', 'subsubdivRhythm',
    'composer', 'trueBPM', 'bpmRatio', 'bpmRatio2', 'bpmRatio3'
  ];
  
  const node = getOrCreatePath(tree, path);
  for (const key of timingKeys) {
    if (key in globals) {
      node[key] = globals[key];
    }
  }
};

/**
 * Copy timing values from tree to globals (for backward compat during migration)
 */
export const syncTreeToGlobals = (tree: TimingTree, path: string, globals: any): void => {
  const values = getTimingValues(tree, path);
  if (values) {
    Object.assign(globals, values);
  }
};
