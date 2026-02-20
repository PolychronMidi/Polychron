// individual profile sources must run before utilities that depend on the accumulated global
// @ts-ignore: load side-effect module with globals
require('./measureProfiles');
// @ts-ignore: load side-effect module with globals
require('./scaleProfiles');
// @ts-ignore: load side-effect module with globals
require('./chordsProfiles');
// @ts-ignore: load side-effect module with globals
require('./modeProfiles');
// @ts-ignore: load side-effect module with globals
require('./pentatonicProfiles');
// @ts-ignore: load side-effect module with globals
require('./bluesProfiles');
// @ts-ignore: load side-effect module with globals
require('./chromaticProfiles');
// @ts-ignore: load side-effect module with globals
require('./quartalProfiles');
// @ts-ignore: load side-effect module with globals
require('./tensionReleaseProfiles');
// @ts-ignore: load side-effect module with globals
require('./modalInterchangeProfiles');
// @ts-ignore: load side-effect module with globals
require('./melodicDevelopmentProfiles');
// @ts-ignore: load side-effect module with globals
require('./voiceLeadingProfiles');
// @ts-ignore: load side-effect module with globals
require('./harmonicRhythmProfiles');

// now that the global has been populated, load utilities that reference it
// @ts-ignore: load side-effect module with globals
require('./profileUtils');
// @ts-ignore: load side-effect module with globals
require('./validateProfiles');
// @ts-ignore: load side-effect module with globals
require('./runtimeProfileAdapter');
// utilities are loaded; profileRegistry remains
// @ts-ignore: load side-effect module with globals
require('./profileRegistry');
