import { Channel } from "./Channel";
import {
  FlowConsumedError,
  ObserverError,
  HasCompletedError,
  FlowRemoveObserverError,
} from "./Errors";
import { ObserverFunction } from "./ObserverFunction";
import { Scope } from "./Scope";
import {
  CancelFunction,
  CoroutineFactory,
  Suspender,
  Observer,
  Collector,
  Coroutine,
} from "./Types";

/**
 * Abstract class for emitting multiple values. A cold flow is doesn't start producing values until
 * it is yield in a coroutine with .collect() or .collectLatest(). Sharing a cold flow with multiple
 * coroutines requires converting it into a SharedEventSubject or SharedStateSubject. Hot flows
 * are EventSubjects and StateSubjects.
 */
export abstract class Flow<T> {
  /**
   * Starts emitting values to an observer. If this is a single use cold Flow, this can only be
   * called once. Hot flows like subjects and shared flows accept multiple observers.
   * adding more than one observer.
   * @param {Observer<T>} observer
   */
  abstract addObserver(observer: Observer<T>): void

  /**
   * Removes an observer from receiving new values from a flow. Only pass in observers that have
   * been previously added. If this is a single use cold flow, it will cancel any running upstream
   * coroutines.
   * @param {Observer<T>} observer
   */
  abstract removeObserver(observer: Observer<T>): void

  /**
   * Converts values emitted using mapper function.
   * @param {(value) => R} mapper
   * @returns {Flow<R>}
   */
  map<R>(mapper: (value: T) => R): Flow<R> {
    return new MapFlow<T, R>(this, mapper);
  }

  /**
   * Values that don't return true from predicate function are not emitted downstream.
   * @param predicate
   */
  filter(predicate: (value: T) => boolean): Flow<T> {
    return new FilterFlow(this, predicate);
  }

  /**
   * Runs binder on each emitted value and combines outputs into a single flow.
   * @param binder
   */
  mergeMap<R>(binder: (value: T) => Flow<R>): Flow<R> {
    return new MergeMapFlow(this, binder);
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
   * @returns {Flow<T>}
   */
  sharedState(): Flow<T> {
    return new SharedStateFlow<T>(this);
  }

  /**
   * Consumes values in upstream Flow. Shares values with downstream flow.
   * @returns {Flow<T>}
   */
  sharedEvent(): Flow<T> {
    return new SharedEventFlow<T>(this);
  }

  /**
   * Collects Flow in scope, ignoring emitted values.
   * @param scope
   */
  launchIn(scope: Scope) {
    const that = this;

    scope.launch(function* () {
      yield that.collect(() => {});
    });
  }

  /**
   * Consumes Flow in scope. Runs collector function on emitted values.
   * @param {(value: T) => void} collector
   * @returns {Suspender<void>}
   */
  collect(collector: (value: T) => void): Suspender<void> {
    return (resultCallback) => {
      const observerFunction = new ObserverFunction(
        collector,
        () => { resultCallback({ value: undefined }); },
        (error) => { resultCallback({ tag: `error`, error }); },
      );

      this.addObserver(observerFunction);

      return () => {
        this.removeObserver(observerFunction);
      };
    };
  }

  /**
   * Consumes Flow in scope. Runs collector coroutine on emitted values. Cancels previously started
   * coroutine if it has not completed.
   * @param {(value: T) => CoroutineFactory<void>} coroutineFactory
   */
  collectLatest(coroutineFactory: (value: T) => CoroutineFactory<void>): Suspender<void> {
    return (resultCallback) => {
      let cancelFunction: CancelFunction | undefined;

      const scope = new Scope({ errorCallback: (error) => {
        resultCallback({ tag: `error`, error });
      }});

      const observer = new ObserverFunction<T>(
        (value) => {
          if (cancelFunction !== undefined) {
            cancelFunction();
          }

          cancelFunction = scope.launch(coroutineFactory(value));
        },
        () => { resultCallback({ value: undefined }); },
        (error) => { resultCallback({ tag: `error`, error }); },
      );

      this.addObserver(observer);

      return () => {
        this.removeObserver(observer);

        if (cancelFunction !== undefined) {
          cancelFunction();
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
    transformer: (value: T, collector: Collector<R>) => CoroutineFactory<void>,
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

  addObserver(observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  emit(value: T) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._observer.emit(this._mapper(value));
  }

  complete() {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }

  error(error: unknown) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.error(error);
  }
}

class FilterFlow<T> extends Flow<T> implements Observer<T> {
  private _observer?: Observer<T>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _predicate: (value: T) => boolean) {
    super();
  }

  addObserver(observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    if (this._predicate(value)) {
      this._observer.emit(value);
    }
  }

  complete() {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }

  error(error: unknown) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.error(error);
  }
}

class MergeMapFlow<T, R> extends Flow<R> implements Observer<T> {
  private _observer?: Observer<R>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _binder: (value: T) => Flow<R>) {
    super();
  }

  addObserver(observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  private _flows = new Map<ObserverFunction<R>, Flow<R>>();

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    const observerFunction = new ObserverFunction<R>(
      (value) => { this._observer!.emit(value); },
      () => {
        this._flows.delete(observerFunction);

        if (this._hasCompleted && this._flows.size === 0) {
          this._observer!.complete();
        }
      },
      (error) => {
        this._flows.delete(observerFunction);
        this.error(error);
      },
    );

    const flow = this._binder(value);
    this._flows.set(observerFunction, flow);
    flow.addObserver(observerFunction);
  }

  complete() {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
  }

  error(error: unknown) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;

    for (const [observerFunction, flow] of this._flows) {
      flow.removeObserver(observerFunction);
    }

    this._observer.error(error);
  }
}

class OnEachFlow<T> extends Flow<T> implements Observer<T> {
  private _observer?: Observer<T>;
  private _hasCompleted = false;

  constructor(private _flow: Flow<T>, private _onEach: (value: T) => void) {
    super();
  }

  addObserver(observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
  }

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._onEach(value);
    this._observer.emit(value);
  }

  complete() {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }

  error(error: unknown) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.error(error);
  }
}

class TransformFlow<T, R> extends Flow<R> implements Observer<T> {
  private _scope?: Scope;
  private _observer?: Observer<R>;
  private _receiverChannel?: Channel<T>;
  private _observerFunction?: ObserverFunction<R>;
  private _hasCompleted = false;

  constructor(
    private _flow: Flow<T>,
    private _transformerFactory: (value: T, collector: Collector<R>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;

    this._scope = new Scope({ errorCallback: (error) => {
      observer.error(error);
    }});

    this._receiverChannel = new Channel<T>({ bufferSize: Infinity });

    this._observerFunction = new ObserverFunction<R>(
      (value) => { observer.emit(value); },
      () => { if (this._hasCompleted) { observer.complete(); } },
      (error) => { this.error(error); },
    );

    const that = this;

    this._scope.launch(function*() {
      while (!that._hasCompleted) {
        yield* this.call(
          that._transformerFactory(
            yield* this.suspend(that._receiverChannel!.receive),
            that._observerFunction!,
          ),
        );
      }
    });

    this._flow.addObserver(this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
    this._scope!.cancel();
  }

  emit(value: T): void {
    if (this._receiverChannel === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    // channel buffer is Infinite so we don't check for failure
    this._receiverChannel.trySend(value);
  }

  complete() {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
  }

  error(error: unknown) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._scope!.cancel();
    this._observer.error(error);
  }
}

class TransformCatch<T> extends Flow<T> implements Observer<T> {
  private _observer?: Observer<T>;
  private _hasCompleted = false;
  private _scope?: Scope;

  constructor(
    private _flow: Flow<T>,
    private _transformerFactory: (error: unknown, collector: Collector<T>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    this._flow.addObserver(this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._flow.removeObserver(this);
    this._scope?.cancel();
  }

  emit(value: T): void {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._observer.emit(value);
  }

  complete() {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;
    this._observer.complete();
  }

  error(error: unknown) {
    if (this._observer === undefined) {
      throw new ObserverError();
    }

    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;

    this._scope = new Scope({ errorCallback: (error) => {
      this._observer?.error(error);
    }});

    this._scope.launch(this._transformerFactory(error, this._observer));
  }
}

class TransformLatestFlow<T, R> extends Flow<R> {
  private _observer?: Observer<R>;
  private _coroutine?: Coroutine<void>;
  private _hasCompleted = false;

  private _scope = new Scope({ errorCallback: (error) => {
    this._observer!.error(error);
  }});

  private _cancel?: CancelFunction;

  constructor(
    private _flow: Flow<T>,
    private _transformerFactory: (value: T, collector: Collector<R>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(observer: Observer<R>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;

    const downstreamObserver = new ObserverFunction<R>(
      (value) => { observer.emit(value); },
      () => { if (this._hasCompleted) { observer.complete(); } },
      (error) => { this._scope._cancelWithError(error); },
    );

    const upstreamObserver = new ObserverFunction<T>(
      (value) => {
        if (this._coroutine !== undefined) {
          this._scope._cancelCallbacks.get(this._coroutine)?.call(undefined);
        }

        this._coroutine = this._transformerFactory(value, downstreamObserver).call(this._scope);
        this._scope._resume(this._coroutine, { value: undefined });
      },
      () => { this._hasCompleted = true; },
      (error) => { this._scope._cancelWithError(error); },
    );

    this._cancel = () => {
      this._flow.removeObserver(upstreamObserver);

      if (this._coroutine !== undefined) {
        this._scope._cancelCallbacks.get(this._coroutine)?.call(undefined);
      }
    };

    this._flow.addObserver(upstreamObserver);
  }

  removeObserver(observer: Observer<R>): void {
    if (this._observer === observer) {
      throw new FlowRemoveObserverError();
    }

    this._scope.cancel();
  }
}

class FlowOf<T> extends Flow<T> {
  private _observer?: Observer<T>;
  private _cancel?: CancelFunction;

  private _scope = new Scope({ errorCallback: (error) => {
    this._observer!.error(error);
  }});

  constructor(
    private _coroutineFactory: (observer: Observer<T>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(observer: Observer<T>): void {
    if (this._observer !== undefined) {
      throw new FlowConsumedError();
    }

    this._observer = observer;
    const that = this;

    this._cancel = this._scope.launch(function* () {
      yield* this.call(that._coroutineFactory(observer));
      observer.complete();
    });
  }

  removeObserver(observer: Observer<T>): void {
    if (this._observer !== observer) {
      throw new FlowRemoveObserverError();
    }

    this._cancel!();
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

  addObserver(observer: Observer<T>): void {
    for (const value of this._values) {
      observer.emit(value);
    }

    observer.complete();
  }

  removeObserver(): void {}
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
    this._flow.addObserver(this);
  }

  addObserver(observer: Observer<T>): void {
    this._observers.add(observer);

    if (this._last !== undefined) {
      observer.emit(this._last.value);
    }

    if (this._hasCompleted) {
      observer.complete();
    }
  }

  removeObserver(observer: Observer<T>): void {
    if (!this._observers.has(observer)) {
      throw new FlowRemoveObserverError();
    }

    this._observers.delete(observer);
  }

  emit(value: T): void {
    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._last = { value };

    for (const observer of this._observers) {
      observer.emit(value);
    }
  }

  complete() {
    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;

    for (const observer of this._observers) {
      observer.complete();
    }
  }

  error(error: unknown) {
    for (const observer of this._observers) {
      observer?.error(error);
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

  addObserver(observer: Observer<T>): void {
    this._observers.add(observer);
  }

  removeObserver(observer: Observer<T>): void {
    if (!this._observers.has(observer)) {
      throw new FlowRemoveObserverError();
    }

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

  addObserver(observer: Observer<T>): void {
    this._observers.add(observer);
    observer.emit(this.value);
  }

  removeObserver(observer: Observer<T>): void {
    if (!this._observers.has(observer)) {
      throw new FlowRemoveObserverError();
    }

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
    this._flow.addObserver(this);
  }

  addObserver(observer: Observer<T>): void {
    this._observers.add(observer);
  }

  removeObserver(observer: Observer<T>): void {
    if (!this._observers.has(observer)) {
      throw new FlowRemoveObserverError();
    }

    this._observers.delete(observer);
  }

  emit(value: T): void {
    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    for (const observer of this._observers) {
      observer.emit(value);
    }
  }

  complete() {
    if (this._hasCompleted) {
      throw new HasCompletedError();
    }

    this._hasCompleted = true;

    for (const observer of this._observers) {
      observer.complete();
    }
  }

  error(error: unknown) {
    for (const observer of this._observers) {
      observer?.error(error);
    }
  }
}
