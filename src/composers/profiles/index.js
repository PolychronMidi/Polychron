// individual profile sources must run before utilities that depend on the accumulated global
require('./measureProfiles');
require('./scaleProfiles');
require('./chordsProfiles');
require('./modeProfiles');
require('./pentatonicProfiles');
require('./bluesProfiles');
require('./chromaticProfiles');
require('./quartalProfiles');
require('./tensionReleaseProfiles');
require('./modalInterchangeProfiles');
require('./melodicDevelopmentProfiles');
require('./voiceLeadingProfiles');
require('./harmonicRhythmProfiles');

// now that the global has been populated, load utilities that reference it
require('./profileUtils');
require('./validateProfiles');
require('./runtimeProfileAdapter');
// utilities are loaded; profileRegistry remains
require('./profileRegistry');
