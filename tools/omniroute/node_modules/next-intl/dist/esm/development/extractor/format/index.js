import path from 'path';
import { throwError } from '../../plugin/utils.js';

const formats = {
  json: {
    codec: () => import('./codecs/JSONCodec.js'),
    extension: '.json'
  },
  po: {
    codec: () => import('./codecs/POCodec.js'),
    extension: '.po'
  }
};
function isBuiltInFormat(format) {
  return typeof format === 'string' && format in formats;
}
function getFormatExtension(format) {
  if (isBuiltInFormat(format)) {
    return formats[format].extension;
  } else {
    return format.extension;
  }
}
async function resolveCodec(format, projectRoot) {
  if (isBuiltInFormat(format)) {
    const factory = (await formats[format].codec()).default;
    return factory();
  } else {
    const resolvedPath = path.isAbsolute(format.codec) ? format.codec : path.resolve(projectRoot, format.codec);
    let module;
    try {
      module = await import(resolvedPath);
    } catch (error) {
      throwError(`Could not load codec from "${resolvedPath}".\n${error}`);
    }
    const factory = module.default;
    if (!factory || typeof factory !== 'function') {
      throwError(`Codec at "${resolvedPath}" must have a default export returned from \`defineCodec\`.`);
    }
    return factory();
  }
}

export { formats as default, getFormatExtension, resolveCodec };
