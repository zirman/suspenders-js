import { ScopeFinishingError } from "./Errors";
import { Flow } from "./Flow";
import { ObserverFunction } from "./ObserverFunction";
import {
  CancelFunction,
  Coroutine,
  CoroutineFactory,
  Collector,
  Result,
  ResultCallback,
  Resume,
  Suspender,
  Observer
} from "./Types";

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

  _cancelCallbacks = new Map<Coroutine<unknown>, CancelFunction>()
  private _finishedCallbacks = new Set<ResultCallback<void>>()
  private _subscopes = new Set<Scope>();
  private _isFinishing = false
  private _isFinished = false
  private _isCanceled = false
  private _isCancelable: boolean
  private _parent?: Scope
  private _errorCallback?: (error: unknown, scope: Scope) => void

  constructor(options?: {
    parent?: Scope,
    errorCallback?: (error: unknown, scope: Scope) => void,
    isCancelable?: boolean,
  }) {
    this._parent = options?.parent;
    this?._parent?._subscopes?.add(this);
    this._errorCallback = options?.errorCallback;
    this._isCancelable = options?.isCancelable ?? true;
  }

  /**
   * Returns true if scope is not canceled.
   */
  isActive(): boolean {
    return !this._isCanceled;
  }

  /**
   * Starts a coroutine in this scope. Scope.call() is the preferred method of calling a coroutine
   * from a running coroutine when blocking on it's result.
   * @param {CoroutineFactory<T>} factory Factory creates a coroutine that is then started in this
   * Scope.
   */
  launch<T>(factory: CoroutineFactory<T>): CancelFunction {
    this._checkIfFinishing();
    const coroutine = factory.call(this);
    this._resume(coroutine, { value: undefined });

    return () => {
      // if there isn't a cancel callback for the coroutine, it was canceled or had completed
      this._cancelCallbacks.get(coroutine)?.call(undefined);
    };
  }

  /**
   * Cancels all coroutines in this scope. All pending suspenders are canceled and all active
   * coroutines finally block is called. If their finally block suspends, they are migrated to a
   * non-canceling scope.
   */
  cancel(): void {
    if (!this._isCancelable || this._isCanceled) {
      return;
    }

    this._isCanceled = true;
    this._parent?._subscopes?.delete(this);

    // cancel all subscopes
    for (const scope of this._subscopes) {
      scope.cancel();
    }

    // cancel all coroutines
    for (const cancelCallback of this._cancelCallbacks.values()) {
      cancelCallback();
    }
  }

  /**
   * Starts the suspender but doesn't wait for it's result. Returns a new suspender that returns the
   * result.
   * @param {Suspender<T>} suspender
   * @return {Suspender<T>}
   */
  async<T>(suspender: Suspender<T>): Suspender<T> {
    this._checkIfFinishing();
    let result: Result<T> | undefined;
    let resultCallback: ResultCallback<T> | undefined;

    return (resCallback) => {
      if (result !== undefined) {
        resCallback(result);
      } else {
        resultCallback = resCallback;
      }

      return suspender(
        (res) => {
          if (resultCallback !== undefined) {
            resultCallback(res);
          } else {
            result = res;
          }
        },
        this,
      );
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
    if (this._isCanceled) {
      return yield* Scope.nonCanceling.call<T>(factory);
    } else {
      const subscope = new Scope({ parent: this });
      const suspender = subscope.callAsync<T>(factory);
      yield subscope._finish();
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
    this._checkIfFinishing();
    let result: Result<T> | undefined;
    let resultCallback: ResultCallback<T> | undefined;
    const coroutine = factory.call(this);

    this._resume(coroutine, { value: undefined }, (res) => {
      if (resultCallback !== undefined) {
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
      }

      return () => {
        // if there isn't a cancel callback for the coroutine, it was canceled or had completed
        this._cancelCallbacks.get(coroutine)?.call(undefined);
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
      const cancelCallbacks: Array<CancelFunction | void | null> = [];

      for (let [index, suspender] of suspenders.entries()) {
        cancelCallbacks.push(suspender(
          (value) => {
            cancelCallbacks[index] = null;

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
          },
          this,
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
   * Resumes a coroutine.
   * @param {Coroutine<T>} coroutine
   * @param {Resume<unknown>} resume
   * @param {(x: T) => void | void} doneCallback
   */
  _resume<T>(
    coroutine: Coroutine<T>,
    resume: Resume<unknown>,
    resultCallback?: ResultCallback<T>,
  ) {
    try {
      const iteratorResult =
        resume.tag === `error`
        ? coroutine.throw(resume.error)
        : resume.tag === `finish`
        ? coroutine.return(undefined as any)
        : coroutine.next(resume.value);

      // coroutine completed without error
      if (iteratorResult.done === true) {
        if (resume.tag !== `finish`) {
          resultCallback?.call(undefined, { value: iteratorResult.value });
        }

        if (this._isFinishing && this._cancelCallbacks.size === 0) {
          this._isFinished = true;

          for (const finishedCallback of this._finishedCallbacks) {
            finishedCallback({ value: undefined });
          }

          this._parent?._subscopes?.delete(this);
        }
      } else {
        // ensure only one callback is called
        let wasCallbackCalled = false;

        // suspending coroutine on Suspender<T>
        const cancelCallback =
          iteratorResult.value(
            (value) => {
              // checks if scope is not canceled and that other callbacks have not been called
              if (!wasCallbackCalled) {
                wasCallbackCalled = true;
                this._cancelCallbacks.delete(coroutine);
                this._resume(coroutine, value, resultCallback);
              }
            },
            this,
          );

        // check if suspender called callback before returning
        if (!wasCallbackCalled) {
          this._cancelCallbacks.set(coroutine, () => {
            if (!wasCallbackCalled) {
              wasCallbackCalled = true;
              this._cancelCallbacks.delete(coroutine);

              if (cancelCallback !== undefined) {
                cancelCallback();
              }

              // calls finally blocks of coroutine
              Scope.nonCanceling._resume(coroutine, { tag: `finish` }, resultCallback);

              if (this._isFinishing && this._cancelCallbacks.size === 0) {
                this._isFinished = true;

                for (const finishedCallback of this._finishedCallbacks) {
                  finishedCallback({ value: undefined });
                }

                this._parent?._subscopes?.delete(this);
              }
            }
          });
        }
      }
    } catch (error) {
      if (error instanceof ScopeFinishingError) {
        console.error(error.stack);
      } else {
        this._cancelWithError(error);
      }
    }
  }

  /**
   * Marks this scope as finishing. Attempting to add new coroutines to this scope will throw a
   * FinishingError(). Returns a suspender that resolves when all the coroutines in this scope have
   * completed.
   * @return {Suspender<T>}
   */
  private _finish(): Suspender<void> {
    return (resultCallback) => {
      if (this._isFinished) {
        resultCallback({ value: undefined });
        return;
      } else {
        this._isFinishing = true;

        if (this._cancelCallbacks.size === 0) {
          this._isFinished = true;
          resultCallback({ value: undefined });
          return;
        } else {
          const finishCallback = () => { resultCallback({ value: undefined }); };
          this._finishedCallbacks.add(finishCallback);
          return () => { this._finishedCallbacks.delete(finishCallback); };
        }
      }
    };
  }

  /**
   * Cancels all coroutines in this scope and calls errorCallback. Bubbles error to parent.
   * @param error
   */
  private _cancelWithError(error: unknown) {
    if (!this._isCancelable || this._isCanceled) {
      return;
    }

    this._isCanceled = true;

    // cancel all subscopes
    for (const scope of this._subscopes) {
      scope.cancel();
    }

    // cancel all coroutines
    for (const cancelCallback of this._cancelCallbacks.values()) {
      cancelCallback();
    }

    try { // handle errors in callbacks
      this._errorCallback?.call(undefined, error, this);
    } catch (anotherError) {
      console.error(`error in error callback ${anotherError.stack}`);
    }

    // bubble up cancelation to parent
    this._parent?._subscopes.delete(this);
    this._parent?._cancelWithError(error);
  }

  /**
   * Checks if new coroutines can be created.
   */
  private _checkIfFinishing() {
    if (this._isFinishing) {
      throw new ScopeFinishingError();
    }
  }

  /**
   * Processes value emitted by flow. Processing of last value is canceled if it has not completed
   * before a new value is emitted.
   * @param flow
   * @param factory
   * @param observer
   */
  transformLatest<T, R>(
    flow: Flow<T>,
    factory: (value: T, observer: Collector<R>) => CoroutineFactory<void>,
    observer: Observer<R>,
  ): CancelFunction {
    let coroutine: Coroutine<void>;
    let hasCompleted = false;

    const downstreamObserver = new ObserverFunction<R>(
      (value) => { observer.emit(value); },
      () => { if (hasCompleted) { observer.complete(); } },
    );

    const upstreamObserver = new ObserverFunction<T>(
      (value) => {
        if (coroutine !== undefined) {
          this._cancelCallbacks.get(coroutine)?.call(undefined);
        }

        coroutine = factory(value, downstreamObserver).call(this);
        this._resume(coroutine, { value: undefined });
      },
      () => { hasCompleted = true; },
    );

    flow.addObserver(this, upstreamObserver);

    return () => {
      flow.removeObserver(upstreamObserver);

      if (coroutine !== undefined) {
        this._cancelCallbacks.get(coroutine)?.call(undefined);
      }
    };
  }
}
