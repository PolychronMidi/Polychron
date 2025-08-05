// Composition State - Immutable state management
export class CompositionState {
  constructor(initialState = {}) {
    this.state = Object.freeze({ ...initialState });
  }

  /**
   * Create a new state instance with updated values
   */
  update(changes) {
    return new CompositionState({
      ...this.state,
      ...changes
    });
  }

  /**
   * Get a value from the state
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Get multiple values as an object
   */
  getAll(keys) {
    const result = {};
    keys.forEach(key => {
      result[key] = this.state[key];
    });
    return result;
  }

  /**
   * Check if a key exists in the state
   */
  has(key) {
    return key in this.state;
  }

  /**
   * Get all state keys
   */
  keys() {
    return Object.keys(this.state);
  }

  /**
   * Get all state values
   */
  values() {
    return Object.values(this.state);
  }

  /**
   * Get the entire state object (frozen)
   */
  getState() {
    return this.state;
  }

  /**
   * Create a subset of the state
   */
  select(keys) {
    const subset = {};
    keys.forEach(key => {
      if (key in this.state) {
        subset[key] = this.state[key];
      }
    });
    return new CompositionState(subset);
  }

  /**
   * Merge with another state instance
   */
  merge(otherState) {
    const otherStateObj = otherState instanceof CompositionState 
      ? otherState.getState() 
      : otherState;
      
    return new CompositionState({
      ...this.state,
      ...otherStateObj
    });
  }

  /**
   * Transform state using a function
   */
  transform(transformFn) {
    const newState = transformFn(this.state);
    return new CompositionState(newState);
  }

  /**
   * Validate state against a schema
   */
  validate(schema) {
    const errors = [];
    
    for (const [key, validator] of Object.entries(schema)) {
      if (!(key in this.state)) {
        if (validator.required) {
          errors.push(`Required key '${key}' is missing`);
        }
        continue;
      }

      const value = this.state[key];
      
      if (validator.type && typeof value !== validator.type) {
        errors.push(`Key '${key}' should be of type ${validator.type}, got ${typeof value}`);
      }

      if (validator.validate && !validator.validate(value)) {
        errors.push(`Key '${key}' failed custom validation`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`State validation failed: ${errors.join(', ')}`);
    }

    return true;
  }

  /**
   * Create a deep clone of the state
   */
  clone() {
    return new CompositionState(JSON.parse(JSON.stringify(this.state)));
  }

  /**
   * Convert to JSON string
   */
  toJSON() {
    return JSON.stringify(this.state);
  }

  /**
   * Create state from JSON string
   */
  static fromJSON(jsonString) {
    try {
      const state = JSON.parse(jsonString);
      return new CompositionState(state);
    } catch (error) {
      throw new Error(`Failed to parse state from JSON: ${error.message}`);
    }
  }

  /**
   * Get state size (number of keys)
   */
  size() {
    return Object.keys(this.state).length;
  }

  /**
   * Check if state is empty
   */
  isEmpty() {
    return this.size() === 0;
  }

  /**
   * Compare with another state
   */
  equals(otherState) {
    const otherStateObj = otherState instanceof CompositionState 
      ? otherState.getState() 
      : otherState;

    const thisKeys = Object.keys(this.state).sort();
    const otherKeys = Object.keys(otherStateObj).sort();

    if (thisKeys.length !== otherKeys.length) {
      return false;
    }

    for (let i = 0; i < thisKeys.length; i++) {
      if (thisKeys[i] !== otherKeys[i]) {
        return false;
      }
      
      if (this.state[thisKeys[i]] !== otherStateObj[otherKeys[i]]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get state differences compared to another state
   */
  diff(otherState) {
    const otherStateObj = otherState instanceof CompositionState 
      ? otherState.getState() 
      : otherState;

    const differences = {
      added: {},
      removed: {},
      changed: {}
    };

    // Find added and changed keys
    for (const [key, value] of Object.entries(this.state)) {
      if (!(key in otherStateObj)) {
        differences.added[key] = value;
      } else if (otherStateObj[key] !== value) {
        differences.changed[key] = {
          from: otherStateObj[key],
          to: value
        };
      }
    }

    // Find removed keys
    for (const key of Object.keys(otherStateObj)) {
      if (!(key in this.state)) {
        differences.removed[key] = otherStateObj[key];
      }
    }

    return differences;
  }
}