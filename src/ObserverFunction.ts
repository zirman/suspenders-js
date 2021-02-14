import { Observer } from "./Types";

/**
 * Wrapper around a function that implements Observer<T>.
 */
export class ObserverFunction<T> implements Observer<T> {
  constructor(private onNext: (value: T) => void, private onComplete: () => void) {}

  emit(value: T) {
    this.onNext(value);
  }

  complete() {
    this.onComplete();
  }
}
