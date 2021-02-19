import { Observer } from "./Types";

/**
 * Wrapper around a function that implements Observer<T>.
 */
export class ObserverFunction<T> implements Observer<T> {
  constructor(
    private _onNext: (value: T) => void,
    private _onComplete: () => void,
    private _onError: (error: unknown) => void,
  ) {}

  emit(value: T) {
    this._onNext(value);
  }

  complete() {
    this._onComplete();
  }

  error(error: unknown) {
    this._onError(error);
  }
}
