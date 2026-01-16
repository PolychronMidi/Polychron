/**
 * Centralized factory for composer creation
 * @class
 */
declare class ComposerFactory {
    static constructors: {
        measure: () => MeasureComposer;
        scale: ({ name, root }?: {
            name?: string;
            root?: string;
        }) => ScaleComposer;
        chords: ({ progression }?: {
            progression?: string[];
        }) => ChordComposer;
        mode: ({ name, root }?: {
            name?: string;
            root?: string;
        }) => ModeComposer;
        pentatonic: ({ root, scaleType }?: {
            root?: string;
            scaleType?: string;
        }) => PentatonicComposer;
        tensionRelease: ({ key, quality, tensionCurve }?: {
            key?: string;
            quality?: string;
            tensionCurve?: number;
        }) => TensionReleaseComposer;
        modalInterchange: ({ key, primaryMode, borrowProbability }?: {
            key?: string;
            primaryMode?: string;
            borrowProbability?: number;
        }) => ModalInterchangeComposer;
        harmonicRhythm: ({ progression, key, measuresPerChord, quality }?: {
            progression?: string[];
            key?: string;
            measuresPerChord?: number;
            quality?: string;
        }) => HarmonicRhythmComposer;
        melodicDevelopment: ({ name, root, developmentIntensity }?: {
            name?: string;
            root?: string;
            developmentIntensity?: number;
        }) => MelodicDevelopmentComposer;
        advancedVoiceLeading: ({ name, root, commonToneWeight }?: {
            name?: string;
            root?: string;
            commonToneWeight?: number;
        }) => AdvancedVoiceLeadingComposer;
    };
    static create(config?: {
        type?: string;
        name?: string;
        root?: string;
        progression?: string[];
        key?: string;
        quality?: string;
        tensionCurve?: number;
        primaryMode?: string;
        borrowProbability?: number;
    }): MeasureComposer;
    /**
     * Creates a composer instance from a config entry.
     * @param {{ type?: string, name?: string, root?: string, progression?: string[], key?: string, quality?: string, tensionCurve?: number, primaryMode?: string, borrowProbability?: number }} config
     * @returns {MeasureComposer}
     */
    static create(config?: {
        type?: string;
        name?: string;
        root?: string;
        progression?: string[];
        key?: string;
        quality?: string;
        tensionCurve?: number;
        primaryMode?: string;
        borrowProbability?: number;
    }): MeasureComposer;
}
/**
 * Instantiates all composers from COMPOSERS config.
 * @type {MeasureComposer[]}
 */
declare let composers: MeasureComposer[];
//# sourceMappingURL=index.d.ts.map