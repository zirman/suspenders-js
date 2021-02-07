import { Observer } from "./Types.js";

/**
 * Wrapper around a function that implements Observer<T>.
 */
export class ObserverFunction<T> implements Observer<T> {
  constructor(private f: (value: T) => void) {}

  emit(value: T) {
    this.f(value);
  }
}
