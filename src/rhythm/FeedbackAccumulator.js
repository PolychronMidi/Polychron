FeedbackAccumulator = (() => {
  const V = validator.create('feedbackAccumulator');

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
    V.assertObject(options, 'FeedbackAccumulator.create options');
    V.assertNonEmptyString(options.name, 'FeedbackAccumulator.create options.name');
    V.assertArray(options.inputs, `FeedbackAccumulator.create(${options.name}): options.inputs must be an array`);
    if (options.inputs.length === 0) throw new Error(`FeedbackAccumulator.create(${options.name}): options.inputs must be a non-empty array`);

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
      V.requireDefined(EventBus, 'EventBus');
      const EVENTS = V.getEventsOrThrow();

      for (const input of options.inputs) {
        if (!input || typeof input !== 'object') {
          throw new Error(`FeedbackAccumulator.initialize(${options.name}): each input must be an object`);
        }
        if (typeof input.eventName !== 'string' || input.eventName.length === 0) {
          throw new Error(`FeedbackAccumulator.initialize(${options.name}): input.eventName must be non-empty string`);
        }
        if (typeof input.project !== 'function') {
          throw new Error(`FeedbackAccumulator.initialize(${options.name}): input.project must be a function`);
        }

        EventBus.on(input.eventName, (data) => {
          const contribution = input.project(data);
          feed(contribution);
          if (typeof options.onInput === 'function') {
            options.onInput(data, contribution, input.eventName);
          }
        });
      }

      EventBus.on(EVENTS.SECTION_BOUNDARY, () => {
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
})();
