import { Flow } from "./Flow.js";
import { Scope } from "./Scope.js";
import { Observer } from "./Types.js";

/**
 * EventSubjects update their observers when there is a new event. Previously emitted values are not
 * replayed on new observers. To replay the last emitted value, use StateSubject. Subjects are hot
 * and can be shared with multipler observers. New flows that observe subjects start cold.
 */
export class EventSubject<T> extends Flow<T> implements Observer<T> {
  private observers: Set<Observer<T>> = new Set();

  addObserver(scope: Scope, observer: Observer<T>): void {
    this.observers.add(observer);
  }

  removeObserver(observer: Observer<T>): void {
    this.observers.delete(observer);
  }

  /**
   * Emits a value to the observer.
   * @param value
   */
  emit(value: T): void {
    for (const observer of this.observers) {
      observer.emit(value);
    }
  }
}
