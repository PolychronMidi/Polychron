const t = require('tonal');
const { Note, Interval } = t;

try {
  console.log('--- Note C ---');
  console.log(JSON.stringify(Note.get('C'), null, 2));

  console.log('--- Interval P5 ---');
  console.log(JSON.stringify(Interval.get('P5'), null, 2));

  console.log('--- Distance C to G ---');
  // Check available functions on Note
  console.log('Note keys:', Object.keys(Note));

  if (Note.distance) {
      console.log('Note.distance(C, G):', Note.distance('C', 'G'));
  }
} catch (e) {
  console.error(e);
}
