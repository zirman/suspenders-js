import { ScopeFinishingError } from "./Errors";
import { Flow } from "./Flow";
import { ObserverFunction } from "./ObserverFunction";
import {
  CancelFunction,
  Coroutine,
  CoroutineFactory,
  Observer,
  Result,
  ResultCallback,
  Resume,
  Suspender
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

  private cancelCallbacks = new Map<Coroutine<unknown>, CancelFunction>()
  private finishedCallbacks = new Set<ResultCallback<void>>()
  private subscopes = new Set<Scope>();
  private isFinishing = false
  private isFinished = false
  private isCanceled = false
  private isCancelable: boolean
  private parent?: Scope
  private errorCallback?: (error: unknown, scope: Scope) => void

  constructor(options?: {
    parent?: Scope,
    errorCallback?: (error: unknown, scope: Scope) => void,
    isCancelable?: boolean,
  }) {
    this.parent = options?.parent;
    this?.parent?.subscopes?.add(this);
    this.errorCallback = options?.errorCallback;
    this.isCancelable = options?.isCancelable ?? true;
  }

  /**
   * Returns true if scope is not canceled.
   */
  isActive(): boolean {
    return !this.isCanceled;
  }

  /**
   * Starts a coroutine in this scope. Scope.call() is the preferred method of calling a coroutine
   * from a running coroutine when blocking on it's result.
   * @param {CoroutineFactory<T>} factory Factory creates a coroutine that is then started in this
   * Scope.
   */
  launch<T>(factory: CoroutineFactory<T>): CancelFunction {
    this.checkIfFinishing();
    const coroutine = factory.call(this);
    this.resume(coroutine, { value: undefined });

    return () => {
      // if there isn't a cancel callback for the coroutine, it was canceled or had completed
      this.cancelCallbacks.get(coroutine)?.call(undefined);
    };
  }

  /**
   * Cancels all coroutines in this scope. All pending suspenders are canceled and all active
   * coroutines finally block is called. If their finally block suspends, they are migrated to a
   * non-canceling scope.
   */
  cancel(): void {
    if (!this.isCancelable || this.isCanceled) {
      return;
    }

    this.isCanceled = true;
    this.parent?.subscopes?.delete(this);

    // cancel all subscopes
    for (const scope of this.subscopes) {
      scope.cancel();
    }

    // cancel all coroutines
    for (const cancelCallback of this.cancelCallbacks.values()) {
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
    this.checkIfFinishing();
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
        }
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
    if (this.isCanceled) {
      return yield* Scope.nonCanceling.call<T>(factory);
    } else {
      const subscope = new Scope({ parent: this });
      const suspender = subscope.callAsync<T>(factory);
      yield subscope.finish();
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
    this.checkIfFinishing();
    let result: Result<T> | undefined;
    let resultCallback: ResultCallback<T> | undefined;
    const coroutine = factory.call(this);

    this.resume(coroutine, { value: undefined }, (res) => {
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
   * Resumes a coroutine.
   * @param {Coroutine<T>} coroutine
   * @param {Resume<unknown>} resume
   * @param {(x: T) => void | void} doneCallback
   */
  private resume<T>(
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
              if (!wasCallbackCalled) {
                wasCallbackCalled = true;
                this.cancelCallbacks.delete(coroutine);
                this.resume(coroutine, value, resultCallback);
              }
            },
          );

        // check if suspender called callback before returning
        if (!wasCallbackCalled) {
          this.cancelCallbacks.set(coroutine, () => {
            if (!wasCallbackCalled) {
              wasCallbackCalled = true;
              this.cancelCallbacks.delete(coroutine);

              if (cancelCallback !== undefined) {
                cancelCallback();
              }

              // calls finally blocks of coroutine
              Scope.nonCanceling.resume(coroutine, { tag: `finish` }, resultCallback);

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
      if (error instanceof ScopeFinishingError) {
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

        if (this.cancelCallbacks.size === 0) {
          this.isFinished = true;
          resultCallback({ value: undefined });
          return;
        } else {
          const finishCallback = () => { resultCallback({ value: undefined }); };
          this.finishedCallbacks.add(finishCallback);
          return () => { this.finishedCallbacks.delete(finishCallback); };
        }
      }
    };
  }

  /**
   * Cancels all coroutines in this scope and calls errorCallback. Bubbles error to parent.
   * @param error
   */
  cancelWithError(error: unknown) {
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
  private checkIfFinishing() {
    if (this.isFinishing) {
      throw new ScopeFinishingError();
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
    collector: (value: T) => void,
  ): Suspender<void> {
    return () => {
      const observerFunction = new ObserverFunction(collector);
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
    factory: (value: T) => CoroutineFactory<void>,
  ): Suspender<void> {
    let coroutine: Coroutine<void>;

    return () => {
      const observer = new ObserverFunction<T>((value) => {
        if (coroutine !== undefined) {
          this.cancelCallbacks.get(coroutine)?.call(undefined);
        }

        coroutine = factory(value).call(this);
        this.resume(coroutine, { value: undefined });
      });

      flow.addObserver(this, observer);

      return () => {
        flow.removeObserver(observer);

        if (coroutine !== undefined) {
          this.cancelCallbacks.get(coroutine)?.call(undefined);
        }
      };
    };
  }

  /**
   *
   * @param flow
   * @param factory
   * @param observer
   */
  transformLatest<T, R>(
    flow: Flow<T>,
    factory: (value: T, observer: Observer<R>) => CoroutineFactory<void>,
    observer: Observer<R>,
  ): CancelFunction {
    let coroutine: Coroutine<void>;

    const internalObserver = new ObserverFunction<T>((value) => {
      if (coroutine !== undefined) {
        this.cancelCallbacks.get(coroutine)?.call(undefined);
      }

      coroutine = factory(value, observer).call(this);
      this.resume(coroutine, { value: undefined });
    });

    flow.addObserver(this, internalObserver);

    return () => {
      flow.removeObserver(internalObserver);

      if (coroutine !== undefined) {
        this.cancelCallbacks.get(coroutine)?.call(undefined);
      }
    };
  }
}
