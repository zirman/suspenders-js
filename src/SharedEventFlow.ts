import { Flow } from "./Flow.js";
import { Scope } from "./Scope.js";
import { Observer } from "./Types.js";

/**
 * Starts observing a upstream flow and shares received values to downstream observers.
 * SharedEventFlow doesn't replay any past emitted values.
 */
export class SharedEventFlow<T> extends Flow<T> implements Observer<T> {
  private observers = new Set<Observer<T>>();

  constructor(private flow: Flow<T>) {
    super();
    this.flow.addObserver(Scope.nonCanceling, this);
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    this.observers.add(observer);
  }

  removeObserver(observer: Observer<T>): void {
    this.observers.delete(observer);
  }

  emit(value: T): void {
    for (const observer of this.observers) {
      observer.emit(value);
    }
  }
}
