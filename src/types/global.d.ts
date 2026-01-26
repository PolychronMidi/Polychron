// Project-wide ambient declarations to reduce initial type-check noise
// Add precise types here gradually as we convert files / add JSDoc.

export {};

declare global {
  // Core runtime globals used throughout the codebase
  interface LMType {
    layers: Record<string, any>;
    activeLayer?: string;
    register?: (...args: any[]) => { state: any, buffer: any };
    activate?: (name: string, isPoly?: boolean) => any;
    advance?: (name: string, advancementType?: string) => void;
  }
  var LM: LMType;
  var PPQ: number;
  var SILENT_OUTRO_SECONDS: any;
  var RF: any;
  var rf: any;
  var allNotesOff: any;
  var muteAll: any;
  var CSVBuffer: any;
  var grandFinale: any;
  var SILENT_OUTRO_SECONDS: any;
  var composers: any;
  var ComposerFactory: any;
  var COMPOSERS: any;
  var stage: any;
  var writeIndexTrace: any;
  var isEnabled: any;
  var writeDebugFile: any;
  var BPM: number;
  var totalSections: number;
  var globalThisValue: any;
  var __POLYCHRON_TEST__: any;

  // Common runtime counters & timing state (added to reduce noise during triage)
  var sectionIndex: any;
  var phraseIndex: any;
  var measureIndex: any;
  var beatIndex: any;
  var divIndex: any;
  var subdivIndex: any;
  var subsubdivIndex: any;
  var numerator: any;
  var denominator: any;
  var divsPerBeat: any;
  var subdivsPerDiv: any;
  var subsubdivsPerSub: any;
  var subsubsPerSub: any;
  var phrasesPerSection: any;
  var measuresPerPhrase: any;
  var tpSection: any;
  var tpPhrase: any;
  var tpMeasure: any;
  var tpSec: any;
  var sectionStart: any;
  var measureStart: any;
  var phraseStart: any;
  var sectionStartTime: any;
  var phraseStartTime: any;
  var measureStartTime: any;
  var beatStart: any;
  var tpBeat: any;
  var beatStartTime: any;
  var divStart: any;
  var tpDiv: any;
  var divStartTime: any;
  var subdivStart: any;
  var tpSubdiv: any;
  var subdivStartTime: any;
  var subsubdivStart: any;
  var tpSubsubdiv: any;
  var subsubdivStartTime: any;
  var spSubsubdiv: any;
  var midiMeter: any;
  var composer: any;

  // Common runtime helpers & constants
  var LOG: any;
  var formatTime: any;
  var LM: any;
  var PPQ: any;
  var SILENT_OUTRO_SECONDS: any;

  // Voice Leading / timing helpers
  var VoiceLeadingScore: any;
  var TimingCalculator: any;
  function loadMarkerMapForLayer(layerName: any): any;
  function findMarkerSecs(layerName: any, partsArr: any): any;
  var stage: any;

  // allow arbitrary globals the tests use (vi, expect etc. are in test-only configs)
  var vi: any;
  var expect: any;
}
