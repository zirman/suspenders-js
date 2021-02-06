/**
 * Wrapper type for all async operations. This function is called to start async operation. If
 * operation can be stopped, it returns a function that cancels operation and cleans up resources
 * used by the operation. Otherise, returns void.
 */
export type Suspender<T> = (s: ResultCallback<T>) => (CancelCallback | void)
/**
 * Data object contains value or error of resolved Suspender<T>
 */
type Result<T> = Readonly<{ tag: `error`, error: unknown } | { tag?: `value`, value: T }>

/**
 * Callback used when Suspender<T> resolves.
 */
type ResultCallback<T> = (result: Result<T>) => void

/**
 * Callback used when Suspender<T> is canceled.
 */
type CancelCallback = () => void

/**
 * Instantiated coroutine.
 */
export type Coroutine<T> = Generator<Suspender<unknown>, T, unknown>

/**
 * Instantiates a coroutine in a scope.
 */
type CoroutineFactory<T> = (this: Scope) => Coroutine<T>

/**
 * Use yield* on this type in a coroutine to get T.
 */
type CoroutineSuspender<T> = Generator<Suspender<T>, T, unknown>

/**
 * Generator that only consumes values of type T.
 */
export type Consumer<T> = Generator<void, void, T>

/**
 * Thrown in coroutines when they have been canceled.
 */
class SuspendAfterCanceledError extends Error {
  name = `SuspendAfterCanceledError`
  message = `Coroutine tried to suspend after being canceled. If cleanup requires suspending, switch to a non-cancelable scope.`
}

/**
 * Thrown in coroutines when they have been canceled.
 */
class FlowConsumedError extends Error {
  name = `FlowConsumedError`
  message = `This flow can only be consumed once. Look into using .sharedState() or .sharedEvent() to share flows.`
}

/**
 * Thrown when attempting to launch a coroutine in a scope that is finishing.
 */
class FinishingError extends Error {
  name = `FinishingError`
  message = `Coroutine tried to launch a new coroutine after scope marked as finishing.`
}

/**
 * Scope is used to start groups of coroutines that are canceled together. If any coroutine in the
 * scope throws an error, it will cancel all the remaining active coroutines within the scope.
 * Scopes canceled with an error will call errorCallback and bubble up errrors to their parent
 * scope.
 */
export class Scope {
  static nonCanceling = new Scope({ isCancelable: false, errorCallback: (error) => {
    console.error(error instanceof Error ? error.stack : error);
  }})

  private cancelCallbacks = new Map<Coroutine<unknown>, CancelCallback>()
  private finishedCallbacks = new Set<ResultCallback<void>>()
  private subscopes = new Set<Scope>();
  private isFinishing = false
  private isFinished = false
  private isCanceled = false
  private isCancelable: boolean
  private parent?: Scope
  private errorCallback?: (error: unknown, scope: Scope) => void

  constructor(args?: {
    parent?: Scope,
    errorCallback?: (error: unknown, scope: Scope) => void,
    isCancelable?: boolean
  }) {
    this.parent = args?.parent;
    this?.parent?.subscopes?.add(this);
    this.errorCallback = args?.errorCallback;
    this.isCancelable = args?.isCancelable ?? true;
  }

  /**
   * Starts a coroutine in this scope. Scope.call() is the preferred method of calling a coroutine
   * from a running coroutine when blocking on it's result.
   * @param {CoroutineFactory<T>} factory Factory creates a coroutine that is then started in this
   * Scope.
   */
  launch<T>(factory: CoroutineFactory<T>): CancelCallback {
    this.checkValid();
    const coroutine = factory.call(this);
    this.resume(coroutine, { value: undefined });
    return () => {
      // if there isn't a cancel callback for the coroutine, it was canceled or had completed
      this.cancelCallbacks.get(coroutine)?.call(undefined);
    };
  }

  foo<T>(coroutine: Coroutine<T>): CancelCallback {
    this.resume(coroutine, { value: undefined });
    return () => {
      // if there isn't a cancel callback for the coroutine, it was canceled or had completed
      this.cancelCallbacks.get(coroutine)?.call(undefined);
    };
  }

  /**
   * Cancels all coroutines in this scope. All pending suspenders are canceled and all active
   * coroutines finally block is called.
   */
  cancel(): void {
    if (!this.isCancelable || this.isCanceled) {
      return;
    }

    this.isCanceled = true;
    this.parent?.subscopes.delete(this);

    // cancel all subscopes
    for (const scope of this.subscopes) {
      scope.cancel();
    }

    // cancel all coroutines
    for (const cancelCallback of this.cancelCallbacks.values()) {
      cancelCallback();
    }
  }

  promiseAsync<T>(promise: Promise<T>): Suspender<T> {
    return this.async((resultCallback) => {
      promise.then(
        (value) => { resultCallback({ value }); },
        (error) => { resultCallback({ tag: `error`, error }); },
      );
    });
  }

  /**
   * Starts the suspender but doesn't wait for it's result. Returns a new suspender that returns the
   * result.
   * @param {Suspender<T>} suspender
   * @return {Suspender<T>}
   */
  async<T>(suspender: Suspender<T>): Suspender<T> {
    // TODO: cancel async suspenders on scope/coroutine canceled
    this.checkValid();
    let result: Result<T>;
    let haveCallback = false;
    let resultCallback: ResultCallback<T>;

    const cancelCallback = suspender(
      (res) => {
        if (haveCallback) {
          resultCallback(res);
        } else {
          result = res;
        }
      }
    );

    return (resCallback) => {
      if (result !== undefined) {
        resCallback(result);
      } else {
        resultCallback = resCallback;
        haveCallback = true;
      }

      return cancelCallback;
    };
  }

  /**
   * Starts a coroutine in scope and waits for all it's subroutines to finish before returning.
   * Internally, this creates a subscope and launches the coroutine in that subscope. When the
   * subscope finishes the results of the coroutine are returned.
   * @param {CoroutineFactory<T>} factory
   */
  *call<T>(factory: CoroutineFactory<T>): Coroutine<T> {
    // if this scope is canceled, then yield was called from a finally block.
    // resume the coroutine on a non canceling scope
    if (this.isCanceled) {
      return yield* Scope.nonCanceling.call<T>(factory);
    } else {
      const scope = new Scope({ parent: this });
      const suspender = scope.callAsync<T>(factory);
      // isCanceled may have changed
      if (!this.isCanceled) {
        yield scope.finish();
      }
      return (yield suspender) as T;
    }
  }

  /**
   * Starts a coroutine in this scope without waiting for it's returned result. Returns a suspender
   * to get the result of the coroutine.
   * @param {CoroutineFactory<T>} factory
   * @return {Suspender<T>}
   */
  callAsync<T>(factory: CoroutineFactory<T>): Suspender<T> {
    this.checkValid();
    let result: Result<T>;
    let haveCallback = false;
    let resultCallback: ResultCallback<T>;
    const coroutine = factory.call(this);

    this.resume(coroutine, { value: undefined }, (res) => {
      if (haveCallback) {
        resultCallback(res);
      } else {
        result = res;
      }
    });

    return (resCallback) => {
      if (result !== undefined) {
        resCallback(result);
      } else {
        resultCallback = resCallback;
        haveCallback = true;
      }

      return () => {
        // if there isn't a cancel callback for the coroutine, it was canceled or had completed
        this.cancelCallbacks.get(coroutine)?.call(undefined);
      };
    };
  }

  /**
   * Returns the first suspender to resolve successfully. All other pending suspenders are canceled.
   * If all suspenders error, throws the last error.
   * @params {Array<Suspender<T>>} suspenders
   * @return {Suspender<T>}
   */
  race<T>(...suspenders: Array<Suspender<T>>): Suspender<T> {
    return (resultCallback) => {
      const cancelCallbacks: Array<CancelCallback | void | null> = [];

      for (let i = 0; i < suspenders.length; i++) {
        const k = i;
        cancelCallbacks.push(suspenders[k](
          (value) => {
            cancelCallbacks[k] = null;

            // cancel all other suspenders
            for (let m = 0; m < suspenders.length; m++) {
              const cancel = cancelCallbacks[m];

              if (cancel) {
                cancel();
              } else {
                cancelCallbacks[m] = null;
              }
            }

            resultCallback(value);
          }
        ));
      }

      return () => {
        for (const cancelCallback of cancelCallbacks) {
          if (cancelCallback) {
            cancelCallback();
          }
        }
      };
    };
  }

  /**
   * Resumes a coroutine with result.
   * @param {Coroutine<T>} coroutine
   * @param {Result<unknown>} result
   * @param {(x: T) => void | void} doneCallback
   */
  private resume<T>(
    coroutine: Coroutine<T>,
    result: Result<unknown>,
    resultCallback?: ResultCallback<T>,
  ) {
    try {
      const iteratorResult =
        result.tag === `error`
        ? coroutine.throw(result.error)
        : coroutine.next(result.value);

      // coroutine completed without error
      if (iteratorResult.done === true) {
        this.cancelCallbacks.delete(coroutine);
        resultCallback?.call(undefined, { value: iteratorResult.value });

        if (this.isFinishing && this.cancelCallbacks.size === 0) {
          this.isFinished = true;

          for (const finishedCallback of this.finishedCallbacks) {
            finishedCallback({ value: undefined });
          }

          this.parent?.subscopes?.delete(this);
        }
      } else {
        // ensures only one callback is called
        let wasCallbackCalled = false;

        // suspending coroutine on Suspender<T>
        const cancelCallback =
          iteratorResult.value(
            (value) => {
              // checks if scope is not canceled and that other callbacks have not been called
              if (!this.isCanceled && !wasCallbackCalled) {
                wasCallbackCalled = true;
                this.resume(coroutine, value, resultCallback);
              }
            }
          );

        // check if suspender called a callback before returning
        if (!wasCallbackCalled) {
          this.cancelCallbacks.set(coroutine, () => {
            this.cancelCallbacks.delete(coroutine);

            if (!wasCallbackCalled) {
              wasCallbackCalled = true;

              if (cancelCallback !== undefined) {
                cancelCallback();
              }

              // calls finally blocks of coroutine
              try {
                Scope.nonCanceling.resumeWithReturn(coroutine, undefined);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                // const result = coroutine.return(undefined as any);

                // if (result.done !== true) {
                //   // move to non-canceling scope
                //   //console.log(`nonCanceling`);
                //   result.value((result) => {
                //     return;
                //   });
                //   Scope.nonCanceling.cancelCallbacks.set(coroutine, () => {
                //     Scope.nonCanceling.cancelCallbacks.get(coroutine)?.call(undefined);
                //   });
                //   //Scope.nonCanceling.resume(coroutine, { value: result.value });
                // }
              } catch (error) {
                console.error(`error in finally block ${error.stack}`);
              }

              if (this.isFinishing && this.cancelCallbacks.size === 0) {
                this.isFinished = true;

                for (const finishedCallback of this.finishedCallbacks) {
                  finishedCallback({ value: undefined });
                }

                this.parent?.subscopes?.delete(this);
              }
            }
          });
        }
      }
    } catch (error) {
      if (error instanceof SuspendAfterCanceledError ||
          error instanceof FinishingError) {
        console.error(error.stack);
      } else {
        this.cancelWithError(error);
      }
    }
  }

  private resumeWithReturn<T>(
    coroutine: Coroutine<T>,
    resultCallback?: ResultCallback<T>,
  ) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const iteratorResult = coroutine.return(undefined as any);

      // coroutine completed without error
      if (iteratorResult.done === true) {
        this.cancelCallbacks.delete(coroutine);
        resultCallback?.call(undefined, { value: iteratorResult.value });

        if (this.isFinishing && this.cancelCallbacks.size === 0) {
          this.isFinished = true;

          for (const finishedCallback of this.finishedCallbacks) {
            finishedCallback({ value: undefined });
          }

          this.parent?.subscopes?.delete(this);
        }
      } else {
        // ensures only one callback is called
        let wasCallbackCalled = false;

        // suspending coroutine on Suspender<T>
        const cancelCallback =
          iteratorResult.value(
            (value) => {
              // checks if scope is not canceled and that other callbacks have not been called
              if (!this.isCanceled && !wasCallbackCalled) {
                wasCallbackCalled = true;
                this.resume(coroutine, value, resultCallback);
              }
            }
          );

        // check if suspender called a callback before returning
        if (!wasCallbackCalled) {
          this.cancelCallbacks.set(coroutine, () => {
            this.cancelCallbacks.delete(coroutine);

            if (!wasCallbackCalled) {
              wasCallbackCalled = true;

              if (cancelCallback !== undefined) {
                cancelCallback();
              }

              // calls finally blocks of coroutine
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const result = coroutine.return(undefined as any);

                if (result.done !== true) {
                  // move to non-canceling scope
                  //console.log(`nonCanceling`);
                  result.value((result) => {
                    return;
                  });
                  Scope.nonCanceling.cancelCallbacks.set(coroutine, () => {
                    Scope.nonCanceling.cancelCallbacks.get(coroutine)?.call(undefined);
                  });
                  //Scope.nonCanceling.resume(coroutine, { value: result.value });
                }
              } catch (error) {
                console.error(`error in finally block ${error.stack}`);
              }

              if (this.isFinishing && this.cancelCallbacks.size === 0) {
                this.isFinished = true;

                for (const finishedCallback of this.finishedCallbacks) {
                  finishedCallback({ value: undefined });
                }

                this.parent?.subscopes?.delete(this);
              }
            }
          });
        }
      }
    } catch (error) {
      if (error instanceof SuspendAfterCanceledError ||
          error instanceof FinishingError) {
        console.error(error.stack);
      } else {
        this.cancelWithError(error);
      }
    }
  }

  /**
   * Marks this scope as finishing. Attempting to add new coroutines to this scope will throw a
   * FinishingError(). Returns a suspender that resolves when all the coroutines in this scope have
   * completed.
   * @return {Suspender<T>}
   */
  private finish(): Suspender<void> {
    return (resultCallback) => {
      if (this.isFinished) {
        resultCallback({ value: undefined });
        return;
      } else {
        this.isFinishing = true;
        this.finishedCallbacks.add(() => { resultCallback({ value: undefined }); });
        return () => { this.finishedCallbacks.delete(resultCallback); };
      }
    };
  }

  private cancelWithError(error: unknown) {
    if (!this.isCancelable || this.isCanceled) {
      return;
    }

    this.isCanceled = true;

    // cancel all subscopes
    for (const scope of this.subscopes) {
      scope.cancel();
    }

    // cancel all coroutines
    for (const cancelCallback of this.cancelCallbacks.values()) {
      cancelCallback();
    }

    try { // handle errors in callbacks
      this.errorCallback?.call(undefined, error, this);
    } catch (anotherError) {
      console.error(`error in error callback ${anotherError.stack}`);
    }

    // bubble up cancelation to parent
    this.parent?.subscopes.delete(this);
    this.parent?.cancelWithError(error);
  }

  /**
   * Checks if new coroutines can be created.
   */
  private checkValid() {
    if (this.isCancelable && this.isCanceled) {
      throw new SuspendAfterCanceledError();
    }

    if (this.isFinishing) {
      throw new FinishingError();
    }
  }

  /**
   * Processes value emitted by flow. Processing of last value is canceled if it has not completed
   * before a new value is emitted.
   * @param flow
   * @param factory
   */
  collect<T>(
    flow: Flow<T>,
    observer: (value: T) => void,
  ): Suspender<void> {
    return () => {
      const observerFunction = new ObserverFunction(observer);
      flow.addObserver(this, observerFunction);

      return () => {
        flow.removeObserver(observerFunction);
      };
    };
  }

  /**
   * Processes value emitted by flow. Processing of last value is canceled if it has not completed
   * before a new value is emitted.
   * @param flow
   * @param factory
   */
  collectLatest<T>(
    flow: Flow<T>,
    factory: (this: Scope, value: T) => Coroutine<void>,
  ): Suspender<void> {
    let coroutine: Coroutine<void> | null = null;

    return () => {
      const observer = new ObserverFunction<T>((value) => {
        if (coroutine !== null) {
          this.cancelCallbacks.get(coroutine)?.call(null);
        }

        coroutine = factory.call(this, value);
        this.resume(coroutine, { value: undefined });
      });

      flow.addObserver(this, observer);

      return () => {
        flow.removeObserver(observer);

        if (coroutine !== null) {
          this.cancelCallbacks.get(coroutine)?.call(null);
        }
      };
    };
  }

  transformLatest<T, R>(
    flow: Flow<T>,
    factory: (value: T, observer: Observer<R>) => (this: Scope) => Coroutine<void>,
    observer: Observer<R>,
  ): CancelCallback {
    let coroutine: Coroutine<void> | null = null;

    const internalObserver = new ObserverFunction<T>((value) => {
      if (coroutine !== null) {
        this.cancelCallbacks.get(coroutine)?.call(null);
      }

      coroutine = factory(value, observer).call(this);
      this.resume(coroutine, { value: undefined });
    });

    flow.addObserver(this, internalObserver);

    return () => {
      flow.removeObserver(internalObserver);

      if (coroutine !== null) {
        this.cancelCallbacks.get(coroutine)?.call(null);
      }
    };
  }
}

export interface Observer<T> {
  emit(value: T): void
}

class ObserverFunction<T> implements Observer<T> {
  constructor(private f: (value: T) => void) {}

  emit(value: T) {
    this.f(value);
  }
}

/**
 * Interface for tranforming zero or more values emitted over time. This interface is cold until it
 * is started by using Scope.collect() in a Coroutine. Because these are cold, tranformations are
 * not shared with multiple Coroutines listening to the same Flow.
 */
abstract class Flow<T> {
  abstract addObserver(scope: Scope, observer: Observer<T>): void
  abstract removeObserver(observer: Observer<T>): void

  map<R>(f: (value: T) => R): Flow<R> {
    return new MapFlow<T, R>(this, f);
  }

  filter(predicate: (value: T) => boolean): Flow<T> {
    return new FilterFlow(this, predicate);
  }

  flatMap<R>(f: (value: T) => Flow<R>): Flow<R> {
    return new FlatMapFlow(this, f);
  }

  onEach(f: (value: T) => void): Flow<T> {
    return new OnEachFlow(this, f);
  }

  sharedState(): Flow<T> {
    return new SharedStateFlow<T>(this);
  }

  sharedEvent(): Flow<T> {
    return new SharedEventFlow<T>(this);
  }

  launchIn(scope: Scope) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;
    scope.launch(function*() {
      yield scope.collect(that, () => undefined);
    });
  }

  collect(scope: Scope, f: (value: T) => void): Suspender<void> {
    return scope.collect(this, f);
  }

  collectLatest(scope: Scope, factory: (this: Scope, value: T) => Coroutine<void>): Suspender<void> {
    return scope.collectLatest(this, factory);
  }

  transform<R>(
    f: (value: T, observer: Observer<R>) => (this: Scope) => Coroutine<void>,
  ): Flow<R> {
    return new TransformFlow(this, f);
  }

  transformLatest<R>(
    f: (value: T, observer: Observer<R>) => (this: Scope) => Coroutine<void>,
  ): Flow<R> {
    return new TransformLatestFlow(this, f);
  }
}

/**
 * Subjects are "hot" because they are inputs for events and state into that exists whether or not
 * it is being observed. produce values even if there are no observers listening for
 * updates. Subjects should be used for injecting event based data like mouse clicks or continuous
 * data like mouse position.
 */

/**
 * EventSubjects are update their observers when there is a new event value. If there was a previous
 * value emitted on EventSubject, it is replayed when there are new observers added. See
 * StateSubject if you need that behavior.
 */
export class EventSubject<T> extends Flow<T> implements Observer<T> {
  private observers: Set<Observer<T>> = new Set();

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

class MapFlow<T, R> extends Flow<R> implements Observer<T> {
  private observer: Observer<R> | null = null;

  constructor(private flow: Flow<T>, private f: (value: T) => R) {
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

    this.observer.emit(this.f(value));
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

  constructor(private flow: Flow<T>, private f: (value: T) => Flow<R>) {
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

    this.f(value).addObserver(this.scope, this.observer);
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
    private f: (value: T, observer: Observer<R>) => (this: Scope) => Coroutine<void>,
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

    this.receiverChannel.trySend(value);
  }
}

class TransformLatestFlow<T, R> extends Flow<R> {
  private observer: Observer<R> | null = null;
  private cancel: CancelCallback | null = null;

  constructor(
    private flow: Flow<T>,
    private f: (value: T, observer: Observer<R>) => (this: Scope) => Coroutine<void>,
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

/**
 * Starts observing a upstream flow and shares received values to downstream observers.
 * SharedStateFlow replay the last emitted value to new observers.
 */
class SharedStateFlow<T> extends Flow<T> implements Observer<T> {
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

/**
 * Starts observing a upstream flow and shares received values to downstream observers.
 * SharedEventFlow doesn't replay any past emitted values.
 */
class SharedEventFlow<T> extends Flow<T> implements Observer<T> {
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

/**
 * StateSubject is always has a value. When hew observers are added, the current value is replayed
 * to the observer. This is used for hot observables that always have a value like mouse position.
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

export class Channel<T> implements Observer<T> {
  private receiverSuspenders: Array<ResultCallback<T>> = []
  private buffer: Array<[T, ResultCallback<void> | void]> = []
  private bufferSize: number

  constructor(args?: { bufferSize?: number }) {
    this.bufferSize = args?.bufferSize ?? 0;
  }

  receive: Suspender<T> = (resultCallback) => {
    const valueCallback = this.buffer.shift();

    // check for a queued value
    if (valueCallback !== undefined) {
      resultCallback({ value: valueCallback[0] });
      const senderSuccessCallback = valueCallback[1];

      // resume producer if suspended
      if (senderSuccessCallback !== undefined) {
        senderSuccessCallback({ value: undefined });
      }

      // count how many suspended senders can be resumed to fill buffer to max
      // const resumeCount =
      //   this.bufferSize - this.buffer
      //     .reduce((x, [, callback]) => x + (callback === undefined ? 0 : 1), 0);

      // const foo = 0;
      // for (let i = 0; i < this.buffer; i++) {
      //   //const sendSuccessCallback = this.buffer[i][1];

      //   if (sendSuccessCallback === undefined) {
      //     bufferCount++;
      //     //sendSuccessCallback({ value: undefined });
      //     //this.buffer[i][1] = undefined;
      //   }
      // }

      return;
    } else {
      this.receiverSuspenders.push(resultCallback);

      return () => {
        const index = this.receiverSuspenders.findIndex((x)=> x === resultCallback);

        if (index !== -1) {
          this.receiverSuspenders.splice(index, 1);
        }
      };
    }
  }

  send(value: T): Suspender<void> {
    return (resultCallback) => {
      const receiver = this.receiverSuspenders.shift();

      if (receiver !== undefined) {
        // receiver was waiting for value
        receiver({ value });
        resultCallback({ value: undefined });
        return;
      } else if (this.buffer.length < this.bufferSize) {
        // buffer value but don't block sender
        const valueCallback: [T, void] = [value, undefined];
        this.buffer.push(valueCallback);
        resultCallback({ value: undefined });
        return;
      } else {
        // block sender until receiver gets value
        const valueCallback: [T, ResultCallback<void>] = [value, resultCallback];
        this.buffer.push(valueCallback);

        return () => {
          const index = this.buffer.findIndex((x) => x === valueCallback);

          if (index !== -1) {
            this.buffer.splice(index, 1);
          }
        };
      }
    };
  }

  emit(value: T): void {
    const receiver = this.receiverSuspenders.shift();

    if (receiver !== undefined) {
      // receiver was waiting for value
      receiver({ value });
    } else if (this.buffer.length < this.bufferSize) {
      // buffer value
      const valueCallback: [T, void] = [value, undefined];
      this.buffer.push(valueCallback);
    } else {
      throw new Error();
    }
  }

  trySend(value: T): boolean {
    const receiver = this.receiverSuspenders.shift();

    if (receiver !== undefined) {
      // receiver was waiting for value
      receiver({ value });
      return true;
    } else if (this.buffer.length < this.bufferSize) {
      // buffer value
      const valueCallback: [T, void] = [value, undefined];
      this.buffer.push(valueCallback);
      return true;
    } else {
      return false;
    }
  }
}

/**
 * Suspends the current coroutine until the suspender results with a value/error or is canceled.
 * @param {Suspender<T>} suspender
 */
export function* suspend<T>(suspender: Suspender<T>): CoroutineSuspender<T> {
  return (yield suspender) as T;
}

/**
 * Suspends on a promise.
 * @param {Promise<T>} promise
 * @return {Suspender<T>}
 */
export function* suspendPromise<T>(promise: Promise<T>): CoroutineSuspender<T> {
  return (yield (resultCallback) => {
    promise.then(
      (value) => { resultCallback({ value }); },
      (error) => { resultCallback({ tag: `error`, error}); }
    );
  }) as T;
}

export function wait(time: number): Suspender<void> {
  return (resultCallback) => {
    const timeout = setTimeout(() => {
      resultCallback({ value: undefined });
    }, time);
    return () => {
      clearTimeout(timeout);
    };
  };
}

export function httpGet(url: string): Suspender<string> {
  return (resultCallback) => {
    const xhttp = new XMLHttpRequest();

    xhttp.onreadystatechange = function() {
      if (this.readyState == 4 && this.status == 200) {
        resultCallback({ value: this.responseText });
      } else {
        resultCallback({ tag: `error`, error: new Error(`code: ${this.status}`) });
      }
    };

    xhttp.open(`GET`, url, true);
    xhttp.send();

    return () => { xhttp.abort(); };
  };
}
