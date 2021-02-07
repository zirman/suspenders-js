import { Channel } from "./Channel.js";
import { FlowConsumedError } from "./Errors.js";
import { Scope } from "./Scope.js";
import { SharedEventFlow } from "./SharedEventFlow.js";
import { SharedStateFlow } from "./SharedStateFlow.js";
import { CancelFunction, Coroutine, CoroutineFactory, Observer, Suspender } from "./Types.js";
import { suspend } from "./Util.js";

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
    scope.launch(function*() {
      yield scope.collect(that, () => undefined);
    });
  }

  /**
   * Consumes Flow in scope. Runs collector function on emitted values.
   * @param scope
   * @param collector
   */
  collect(scope: Scope, collector: (value: T) => void): Suspender<void> {
    return scope.collect(this, collector);
  }

  /**
   * Consumes Flow in scope. Runs collector coroutine on emitted values. Cancels previously started
   * coroutine if it has not completed.
   * @param scope
   * @param factory
   */
  collectLatest(scope: Scope, factory: (value: T) => CoroutineFactory<void>): Suspender<void> {
    return scope.collectLatest(this, factory);
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
   * Runs a coroutine on each value and emits values through observer. Cancels previous coroutine if
   * it has not completed.
   * @param transformer
   */
  transformLatest<R>(
    transformer: (value: T, observer: Observer<R>) => CoroutineFactory<void>,
  ): Flow<R> {
    return new TransformLatestFlow(this, transformer);
  }
}

class MapFlow<T, R> extends Flow<R> implements Observer<T> {
  private observer: Observer<R> | null = null;

  constructor(private flow: Flow<T>, private mapper: (value: T) => R) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this.observer !== null) {
      throw new FlowConsumedError();
    }

    this.observer = observer;
    this.flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this.observer === observer) {
      this.flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T) {
    if (this.observer === null) {
      throw new FlowConsumedError();
    }

    this.observer.emit(this.mapper(value));
  }
}

class FilterFlow<T> extends Flow<T> implements Observer<T> {
  private observer: Observer<T> | null = null;

  constructor(private flow: Flow<T>, private predicate: (value: T) => boolean) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    if (this.observer !== null) {
      throw new FlowConsumedError();
    }

    this.observer = observer;
    this.flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this.observer === observer) {
      this.flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this.observer === null) {
      throw new FlowConsumedError();
    }

    if (this.predicate(value)) {
      this.observer.emit(value);
    }
  }
}

class FlatMapFlow<T, R> extends Flow<R> implements Observer<T> {
  private scope: Scope | null = null;
  private observer: Observer<R> | null = null;

  constructor(private flow: Flow<T>, private binder: (value: T) => Flow<R>) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this.observer !== null) {
      throw new FlowConsumedError();
    }

    this.scope = scope;
    this.observer = observer;
    this.flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<R>): void {
    if (this.observer === observer) {
      this.flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this.observer === null || this.scope === null) {
      throw new FlowConsumedError();
    }

    this.binder(value).addObserver(this.scope, this.observer);
  }
}

class OnEachFlow<T> extends Flow<T> implements Observer<T> {
  private observer: Observer<T> | null = null;

  constructor(private flow: Flow<T>, private f: (value: T) => void) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<T>): void {
    if (this.observer !== null) {
      throw new FlowConsumedError();
    }

    this.observer = observer;
    this.flow.addObserver(scope, this);
  }

  removeObserver(observer: Observer<T>): void {
    if (this.observer === observer) {
      this.flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this.observer === null) {
      throw new FlowConsumedError();
    }

    this.f(value);
    this.observer.emit(value);
  }
}

class TransformFlow<T, R> extends Flow<R> implements Observer<T> {
  private scope: Scope | null = null;
  private observer: Observer<R> | null = null;
  private receiverChannel: Channel<T> | null = null;

  constructor(
    private flow: Flow<T>,
    private f: (value: T, observer: Observer<R>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    if (this.observer !== null) {
      throw new FlowConsumedError();
    }

    this.scope = scope;
    this.observer = observer;
    this.flow.addObserver(scope, this);

    const receiverChannel = new Channel<T>({ bufferSize: Infinity });
    this.receiverChannel = receiverChannel;
    const f = this.f;

    this.scope.launch(function*() {
      for (;;) {
        yield* this.call(f(yield* suspend(receiverChannel.receive), observer));
      }
    });
  }

  removeObserver(observer: Observer<R>): void {
    if (this.observer === observer) {
      this.flow.removeObserver(this);
    } else {
      throw new FlowConsumedError();
    }
  }

  emit(value: T): void {
    if (this.receiverChannel === null) {
      throw new FlowConsumedError();
    }

    // channel buffer is Infinite so we don't check for failure
    this.receiverChannel.trySend(value);
  }
}

class TransformLatestFlow<T, R> extends Flow<R> {
  private observer: Observer<R> | null = null;
  private cancel: CancelFunction | null = null;

  constructor(
    private flow: Flow<T>,
    private f: (value: T, observer: Observer<R>) => CoroutineFactory<void>,
  ) {
    super();
  }

  addObserver(scope: Scope, observer: Observer<R>): void {
    this.observer = observer;
    this.cancel = scope.transformLatest(this.flow, this.f, observer);
  }

  removeObserver(observer: Observer<R>): void {
    if (this.observer === observer) {
      this.cancel?.call(null);
    } else {
      throw new FlowConsumedError();
    }
  }
}
