import { Flow } from "./Flow.js";
import { Scope } from "./Scope.js";
import { Observer } from "./Types.js";

/**
 * Starts observing a upstream flow and shares received values to downstream observers.
 * SharedStateFlow replay the last emitted value to new observers.
 */
export class SharedStateFlow<T> extends Flow<T> implements Observer<T> {
  private observers = new Set<Observer<T>>();
  private last: { value: T } | null = null;

  constructor(private flow: Flow<T>) {
    super();
    this.flow.addObserver(Scope.nonCanceling, this);
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    this.observers.add(observer);

    if (this.last !== null) {
      observer.emit(this.last.value);
    }
  }

  removeObserver(observer: Observer<T>): void {
    this.observers.delete(observer);
  }

  emit(value: T): void {
    this.last = { value };

    for (const observer of this.observers) {
      observer.emit(value);
    }
  }
}
