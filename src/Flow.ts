import { Channel } from "./Channel";
import {
  FlowCompleteError,
  FlowConsumedError,
  FlowEmitError,
  FlowHasCompletedError,
  FlowRemoveObserverError
} from "./Errors";
import { ObserverFunction } from "./ObserverFunction";
import { Scope } from "./Scope";
import {
  CancelFunction,
  CoroutineFactory,
  Suspender,
  Observer,
  Collector,
  Coroutine
} from "./Types";
import { suspend } from "./Util";

/**
 * Abstract class for emitting multiple values. Normally, a flow is cold and doesn't start producing
 * values until it is consumed with .collect() or another consuming method. Sharing a cold flow with
 * multiple coroutines requires converting it into a SharedEventSubject or SharedStateSubject.
 */
export abstract class Flow<T> {
  abstract addObserver(scope: Scope, observer: Observer<T>): void
  abstract removeObserver(observer: Observer<T>): void

  /**
   * Converts values emitted using mapper function.
   * @param mapper
   */
  map<R>(mapper: (value: T) => R): Flow<R> {
    return new MapFlow<T, R>(this, mapper);
  }

  /**
   * Values that don't return true from predicate function are not emitted.
   * @param predicate
   */
  filter(predicate: (value: T) => boolean): Flow<T> {
    return new FilterFlow(this, predicate);
  }

  /**
   * Runs binder on each emitted value and combines outputs into a single flow.
   * @param binder
   */
  flatMap<R>(binder: (value: T) => Flow<R>): Flow<R> {
    return new FlatMapFlow(this, binder);
  }

  /**
   * Runs f on each value but doesn't change values emitted in downstream flow.
   * @param f
   */
  onEach(f: (value: T) => void): Flow<T> {
    return new OnEachFlow(this, f);
  }

  /**
   * Consumes values in upstream Flow. Shares values with downstream flow. Replays last value
   * emitted on new observers.
   */
  sharedState(): Flow<T> {
    return new SharedStateFlow<T>(this);
  }

  /**
   * Consumes values in upstream Flow. Shares values with downstream flow.
   */
  sharedEvent(): Flow<T> {
    return new SharedEventFlow<T>(this);
  }

  /**
   * Consumes Flow in scope, ignoring emitted vaues.
   * @param scope
   */
  launchIn(scope: Scope) {
    const that = this;

    scope.launch(function* () {
      yield that.collect(() => undefined);
    });
  }

  /**
   * Consumes Flow in scope. Runs collector function on emitted values.
   * @param scope
   * @param collector
   */
  collect(collector: (value: T) => void): Suspender<void> {
    return (resultCallback, scope) => {
      const observerFunction = new ObserverFunction(collector, () => {
        resultCallback({ value: undefined });
      });

      this.addObserver(scope, observerFunction);

      return () => {
        this.removeObserver(observerFunction);
      };
    };
  }

  /**
   * Consumes Flow in scope. Runs collector coroutine on emitted values. Cancels previously started
   * coroutine if it has not completed.
   * @param scope
   * @param factory
   */
  collectLatest(factory: (value: T) => CoroutineFactory<void>): Suspender<void> {
    let coroutine: Coroutine<void>;

    return (resultCallback, scope) => {
      const observer = new ObserverFunction<T>(
        (value) => {
          if (coroutine !== undefined) {
            scope._cancelCallbacks.get(coroutine)?.call(undefined);
          }

          coroutine = factory(value).call(scope);
          scope._resume(coroutine, { value: undefined });
        },
        () => {
          resultCallback({ value: undefined });
        }
      );

      this.addObserver(scope, observer);

      return () => {
        this.removeObserver(observer);

        if (coroutine !== undefined) {
          scope._cancelCallbacks.get(coroutine)?.call(undefined);
        }
      };
    };
  }

  /**
   * Runs coroutine on each value and emits values through observer. Waits for each
   * coroutine to complete before starting the next. Because there is no backpressure with flow, use
   * care to make sure that emitted values don't buffer uncontrollably.
   * @param transformer
   */
  transform<R>(
    transformer: (value: T, observer: Observer<R>) => CoroutineFactory<void>,
  ): Flow<R> {
    return new TransformFlow(this, transformer);
  }

  /**
   * Errors thrown upstream are caught and passed into coroutine factory. Resumes sending values
   * emitted to observer.
   * @param factory
   */
  catch(factory: (error: unknown, collector: Collector<T>) => CoroutineFactory<void>): Flow<T> {
    return new TransformCatch(this, factory);
  }

  /**
   * Runs a coroutine on each value and emits values through observer. Cancels previous coroutine if
   * it has not completed.
   * @param transformer
   */
  transformLatest<R>(
    transformer: (value: T, collector: Collector<R>) => CoroutineFactory<void>,
  ): Flow<R> {
    return new TransformLatestFlow(this, transformer);
  }
}

class MapFlow<T, R> extends Flow<R> implements Observer<T> {
  private _observer?: Observer<R>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _mapper: (value: T) => R) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  emit(value: T) {
    if (this._observer === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._observer.emit(this._mapper(value));
  }

  complete() {
    if (this._observer === undefined) {
      throw new FlowCompleteError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }
}

class FilterFlow<T> extends Flow<T> implements Observer<T> {
  private _observer?: Observer<T>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _predicate: (value: T) => boolean) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    if (this._predicate(value)) {
      this._observer.emit(value);
    }
  }

  complete() {
    if (this._observer === undefined) {
      throw new FlowCompleteError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }
}

class FlatMapFlow<T, R> extends Flow<R> implements Observer<T> {
  private _scope?: Scope;
  private _observer?: Observer<R>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _binder: (value: T) => Flow<R>) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._scope = scope;
    this._observer = observer;
    this._flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  emit(value: T): void {
    if (this._observer === undefined || this._scope === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._binder(value).addObserver(this._scope, this._observer);
  }

  complete() {
    if (this._observer === undefined) {
      throw new FlowCompleteError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }
}

class OnEachFlow<T> extends Flow<T> implements Observer<T> {
  private _observer?: Observer<T>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _onEach: (value: T) => void) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer === observer) {
      this._flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._onEach(value);
    this._observer.emit(value);
  }

  complete() {
    if (this._observer === undefined) {
      throw new FlowCompleteError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._observer.complete();
  }
}

class TransformFlow<T, R> extends Flow<R> implements Observer<T> {
  private _scope?: Scope;
  private _observer?: Observer<R>;
  private _receiverChannel?: Channel<T>;
  private _hasCompleted = false;

  constructor(
    private _flow: Flow<T>,
    private _transformerFactory: (value: T, observer: Observer<R>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._scope = scope;
    this._observer = observer;
    this._flow.addObserver(scope, this);

    const receiverChannel = new Channel<T>({ bufferSize: Infinity });
    this._receiverChannel = receiverChannel;
    const transformerFactory = this._transformerFactory;
    const transformFlow = this;

    this._scope.launch(function*() {
      // TODO complete if canceled with no items queued
      while (!transformFlow._hasCompleted) {
        yield* this.call(transformerFactory(yield* suspend(receiverChannel.receive), observer));
      }
    });
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer === observer) {
      this._flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this._receiverChannel === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    // channel buffer is Infinite so we don't check for failure
    this._receiverChannel.trySend(value);
  }

  complete() {
    if (this._observer === undefined) {
      throw new FlowCompleteError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;
  }
}

class TransformCatch<T> extends Flow<T> implements Observer<T> {
  private _observer?: Observer<T>;
  private _hasCompleted = false;

  constructor(
    private _flow: Flow<T>,
    private _transformerFactory: (error: unknown, observer: Observer<T>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;

    this._flow.addObserver(
      new Scope({ errorCallback: (error) => {
        scope.launch(this._transformerFactory(error, this));
      }}),
      this,
    );
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer === observer) {
      this._flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._observer.emit(value);
  }

  complete() {
    if (this._observer === undefined) {
      throw new FlowEmitError();
    }

    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }
}

class TransformLatestFlow<T, R> extends Flow<R> {
  private _observer?: Observer<R>;
  private _cancel?: CancelFunction;

  constructor(
    private _flow: Flow<T>,
    private _transformerFactory: (value: T, collector: Collector<R>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._cancel = scope.transformLatest(this._flow, this._transformerFactory, observer);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer === observer) {
      this._cancel?.call(null);
    } else {
      throw new FlowConsumedError();
    }
  }
}

class FlowOf<T> extends Flow<T> {
  private _observer?: Observer<T>;
  private _cancel?: CancelFunction;

  constructor(
    private _coroutineFactory: (observer: Observer<T>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    const coroutineFactory = this._coroutineFactory(observer);

    this._cancel = scope.launch(function* () {
      yield* this.call(coroutineFactory);
      observer.complete();
    });
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer === observer) {
      this._cancel!();
    } else {
      throw new FlowConsumedError();
    }
  }
}

export const flowOf = <T>(factory: (collector: Collector<T>) => CoroutineFactory<void>): Flow<T> =>
  new FlowOf(factory);

class FlowOfValues<T> extends Flow<T> {
  private _values: Array<T>;

  constructor(...args: Array<T>) {
    super();
    this._values = args;
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    for (const value of this._values) {
      observer.emit(value);
    }

    observer.complete();
  }

  removeObserver(observer: Observer<T>): void {
  }
}

export const flowOfValues = <T>(...args: Array<T>): Flow<T> =>
  new FlowOfValues(...args);

/**
 * Starts observing a upstream flow and shares received values to downstream observers.
 * SharedStateFlow replay the last emitted value to new observers.
 */
export class SharedStateFlow<T> extends Flow<T> implements Observer<T> {
  private _observers = new Set<Observer<T>>();
  private _last?: { value: T };
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>) {
    super();
    this._flow.addObserver(Scope.nonCanceling, this);
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    this._observers.add(observer);

    if (this._last !== undefined) {
      observer.emit(this._last.value);
    }

    if (this._hasCompleted) {
      observer.complete();
    }
  }

  removeObserver(observer: Observer<T>): void {
    this._observers.delete(observer);
  }

  emit(value: T): void {
    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._last = { value };

    for (const observer of this._observers) {
      observer.emit(value);
    }
  }

  complete() {
    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;

    for (const observer of this._observers) {
      observer.complete();
    }
  }
}

/**
 * EventSubjects update their observers when there is a new event. Previously emitted values are not
 * replayed on new observers. To replay the last emitted value, use StateSubject. Subjects are hot
 * and can be shared with multipler observers. New flows that observe subjects start cold.
 */
export class EventSubject<T> extends Flow<T> implements Collector<T> {
  private _observers: Set<Observer<T>> = new Set();

  addObserver(scope: Scope, observer: Observer<T>): void {
    this._observers.add(observer);
  }

  removeObserver(observer: Observer<T>): void {
    this._observers.delete(observer);
  }

  /**
   * Emits a value to the observer.
   * @param value
   */
  emit(value: T): void {
    for (const observer of this._observers) {
      observer.emit(value);
    }
  }
}

/**
 * StateSubject always have a value. When new observers are added, the last emitted value is
 * replayed. This is generally used used for hot observables like the mouse position. Subjects are
 * hot and can be shared with multipler observers. New flows that observe subjects start cold.
 */
export class StateSubject<T> extends Flow<T> implements Collector<T> {
  private _observers: Set<Observer<T>> = new Set()

  constructor(public value: T) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    this._observers.add(observer);
    observer.emit(this.value);
  }

  removeObserver(observer: Observer<T>): void {
    this._observers.delete(observer);
  }

  emit(value: T): void {
    this.value = value;

    for (const observer of this._observers) {
      observer.emit(value);
    }
  }

  get(): T {
    return this.value;
  }
}

/**
 * Starts observing a upstream flow and shares received values to downstream observers.
 * SharedEventFlow doesn't replay any past emitted values.
 */
export class SharedEventFlow<T> extends Flow<T> implements Observer<T> {
  private _observers = new Set<Observer<T>>();
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>) {
    super();
    this._flow.addObserver(Scope.nonCanceling, this);
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    this._observers.add(observer);
  }

  removeObserver(observer: Observer<T>): void {
    this._observers.delete(observer);
  }

  emit(value: T): void {
    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    for (const observer of this._observers) {
      observer.emit(value);
    }
  }

  complete() {
    if (this._hasCompleted) {
      throw new FlowHasCompletedError();
    }

    this._hasCompleted = true;

    for (const observer of this._observers) {
      observer.complete();
    }
  }
}
