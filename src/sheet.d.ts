/**
 * Composer configuration object
 */
interface ComposerConfig {
    type: string;
    name?: string;
    root?: string;
    scale?: any;
    progression?: string[] | string;
    motif?: number[];
    weight?: number;
    phrases?: any;
    bpmScale?: number;
    dynamics?: string;
    scaleType?: string;
    quality?: string;
    tensionCurve?: number;
    primaryMode?: string;
    borrowProbability?: number;
    developmentIntensity?: number;
    commonToneWeight?: number;
    measuresPerChord?: number;
    key?: string;
}
/**
 * Range configuration with optional weights
 */
interface RangeConfig {
    min: number;
    max: number;
    weights?: number[];
}
/**
 * Section type configuration
 */
interface SectionType {
    type: string;
    weight: number;
    phrases: {
        min: number;
        max: number;
    };
    bpmScale: number;
    dynamics: string;
    motif: number[];
}
/**
 * Binaural configuration
 */
interface BinauralConfig {
    min: number;
    max: number;
}
export declare const primaryInstrument: string;
export declare const secondaryInstrument: string;
export declare const otherInstruments: number[];
export declare const bassInstrument: string;
export declare const bassInstrument2: string;
export declare const otherBassInstruments: number[];
export declare const drumSets: number[];
export declare const LOG: string;
export declare const TUNING_FREQ: number;
export declare const BINAURAL: BinauralConfig;
export declare const PPQ: number;
export declare const BPM: number;
export declare const NUMERATOR: RangeConfig;
export declare const DENOMINATOR: RangeConfig;
export declare const OCTAVE: RangeConfig;
export declare const VOICES: RangeConfig;
export declare const SECTION_TYPES: SectionType[];
export declare const PHRASES_PER_SECTION: RangeConfig;
export declare const SECTIONS: RangeConfig;
export declare const DIVISIONS: RangeConfig;
export declare const SUBDIVISIONS: RangeConfig;
export declare const SUBSUBDIVS: RangeConfig;
export declare const COMPOSERS: ComposerConfig[];
export declare const SILENT_OUTRO_SECONDS: number;
export {};
//# sourceMappingURL=sheet.d.ts.map