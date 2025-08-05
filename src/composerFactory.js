// Composer Factory - Creates composer instances based on type
import { RandomScaleComposer } from './randomScaleComposer.js';
import { RandomChordComposer } from './randomChordComposer.js';
import { RandomModeComposer } from './randomModeComposer.js';
import { ScaleComposer } from './scaleComposer.js';
import { ChordComposer } from './chordComposer.js';
import { ModeComposer } from './modeComposer.js';

export class ComposerFactory {
  static create(type, config = {}) {
    switch (type) {
      case 'randomScale':
        return new RandomScaleComposer(config);
      
      case 'randomChord':
        return new RandomChordComposer(config);
      
      case 'randomMode':
        return new RandomModeComposer(config);
      
      case 'scale':
        return new ScaleComposer(config.scaleName, config.root, config);
      
      case 'chord':
        return new ChordComposer(config.progression, config);
      
      case 'mode':
        return new ModeComposer(config.modeName, config.root, config);
      
      default:
        throw new Error(`Unknown composer type: ${type}`);
    }
  }

  static getAvailableTypes() {
    return [
      'randomScale',
      'randomChord', 
      'randomMode',
      'scale',
      'chord',
      'mode'
    ];
  }

  static validateConfig(type, config) {
    const requiredFields = {
      'scale': ['scaleName', 'root'],
      'chord': ['progression'],
      'mode': ['modeName', 'root']
    };

    const required = requiredFields[type];
    if (required) {
      for (const field of required) {
        if (!(field in config)) {
          throw new Error(`Missing required field '${field}' for composer type '${type}'`);
        }
      }
    }

    return true;
  }
}