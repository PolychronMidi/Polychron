moduleLifecycle.declare({
  name: 'feedbackAccumulator',
  subsystem: 'rhythm',
  deps: ['eventBus', 'validator'],
  provides: ['feedbackAccumulator'],
  init: (deps) => {
  const eventBus = deps.eventBus;
  const V = deps.validator.create('feedbackAccumulator');

  /**
   * @param {{
   *  name: string,
   *  decayRate: number,
   *  inputs: Array<{eventName:string, project:(data:any)=>number}>,
   *  onInput?: (data:any, contribution:number, eventName:string)=>void,
   *  onReset?: ()=>void
   * }} options
   */
  function create(options) {
    V.assertObject(options, 'feedbackAccumulator.create options');
    V.assertNonEmptyString(options.name, 'feedbackAccumulator.create options.name');
    V.assertArray(options.inputs, `feedbackAccumulator.create(${options.name}): options.inputs must be an array`);
    if (options.inputs.length === 0) throw new Error(`feedbackAccumulator.create(${options.name}): options.inputs must be a non-empty array`);

    const decayRate = clamp(Number(options.decayRate), 0, 0.9999);
    let value = 0;
    let initialized = false;

    function feed(contribution) {
      const amount = clamp(Number(contribution), 0, 1);
      value = value * decayRate + amount * (1 - decayRate);
      return value;
    }

    function initialize() {
      if (initialized) return;
      V.requireDefined(eventBus, 'eventBus');
      const EVENTS = V.getEventsOrThrow();

      for (const input of options.inputs) {
        V.assertObject(input, 'input');
        V.assertNonEmptyString(input.eventName, 'input.eventName');
        V.requireType(input.project, 'function', 'input.project');

        eventBus.on(input.eventName, (data) => {
          const contribution = input.project(data);
          feed(contribution);
          if (typeof options.onInput === 'function') {
            options.onInput(data, contribution, input.eventName);
          }
        });
      }

      eventBus.on(EVENTS.SECTION_BOUNDARY, () => {
        value = 0;
        if (typeof options.onReset === 'function') {
          options.onReset();
        }
      });

      initialized = true;
    }

    function getIntensity() {
      return clamp(value, 0, 1);
    }

    function decay() {
      value *= decayRate;
    }

    function reset() {
      value = 0;
    }

    return {
      initialize,
      feed,
      getIntensity,
      decay,
      reset
    };
  }

  return {
    create
  };
  },
});
