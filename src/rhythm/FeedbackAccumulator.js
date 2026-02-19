FeedbackAccumulator = (() => {
  const EVENTS = (typeof EventCatalog !== 'undefined' && EventCatalog && EventCatalog.names)
    ? EventCatalog.names
    : { SECTION_BOUNDARY: 'section-boundary' };

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
    if (!options || typeof options !== 'object') {
      throw new Error('FeedbackAccumulator.create: options must be an object');
    }
    if (typeof options.name !== 'string' || options.name.length === 0) {
      throw new Error('FeedbackAccumulator.create: options.name must be a non-empty string');
    }
    if (!Array.isArray(options.inputs) || options.inputs.length === 0) {
      throw new Error(`FeedbackAccumulator.create(${options.name}): options.inputs must be a non-empty array`);
    }

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
      if (typeof EventBus === 'undefined' || !EventBus || typeof EventBus.on !== 'function') {
        throw new Error(`FeedbackAccumulator.initialize(${options.name}): EventBus not available`);
      }

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
