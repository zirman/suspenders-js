import { Flow } from "./Flow.js";
import { Scope } from "./Scope.js";
import { Observer } from "./Types.js";

/**
 * StateSubject always have a value. When new observers are added, the last emitted value is
 * replayed. This is generally used used for hot observables like the mouse position. Subjects are
 * hot and can be shared with multipler observers. New flows that observe subjects start cold.
 */
export class StateSubject<T> extends Flow<T> implements Observer<T> {
  private observers: Set<Observer<T>> = new Set()

  constructor(public value: T) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    this.observers.add(observer);
    observer.emit(this.value);
  }

  removeObserver(observer: Observer<T>): void {
    this.observers.delete(observer);
  }

  emit(value: T): void {
    this.value = value;

    for (const observer of this.observers) {
      observer.emit(value);
    }
  }

  get(): T {
    return this.value;
  }
}
