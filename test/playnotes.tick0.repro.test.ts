import { PlayNotes } from '../src/playNotes.js';
import { getPolychronContext } from '../src/PolychronInit.js';

// Fast unit test: seed minimal context to reproduce NOTE ON at tick 0 when tpSubdiv==0
it('PlayNotes: should not emit NOTE ON at tick 0 (tpSubdiv fallback)', () => {
  const poly = getPolychronContext();
  poly.test = poly.test || {} as any;

  // Provide deterministic utils
  poly.utils = poly.utils || {} as any;
  poly.utils.rf = (min = 0, max = 1) => (Math.random() * (max - min) + min);
  poly.utils.ri = (min = 0, max = 1) => Math.floor(Math.random() * (max - min + 1) + min);
  poly.utils.rv = (v: number) => v;

  const events: any[] = [];
  const fakeContainer = {
    has: (name: string) => name === 'pushMultiple',
    get: (name: string) => {
      if (name === 'pushMultiple') return (buffer: any, ...items: any[]) => {
        events.push(...items.map((it:any) => ({ ...it, tick: Math.round(Number(it.tick) || 0) })));
      };
    }
  } as any;

  const ctx: any = {
    state: {
      subdivStart: 0,
      tpSubdiv: 0, // problematic value that could cause note at tick 0
      tpDiv: 480,
      subdivsPerDiv: 4,
      velocity: 80,
      bpmRatio3: 1,
      subdivsPerBeat: 4,
      midiBPM: 120,
      beatRhythm: [0],
      divRhythm: [0],
      subdivRhythm: [0],
      beatIndex: 0,
      divIndex: 0,
      subdivIndex: 0,
      subdivsOff: 0,
      subdivsOn: 0,
      divsOff: 0,
      divsOn: 0,
      beatsOff: 0,
      beatsOn: 0,
      composer: { getNotes: () => [{ note: 60 }] },
    },
    container: fakeContainer,
    csvBuffer: events,
  } as any;

  const pn = new PlayNotes();
  pn.playNotes(ctx);

  const onEvents = events.filter(e => e.type === 'on');
  const zeroOn = onEvents.some(e => e.tick === 0);
  expect(zeroOn).toBe(false);
});
