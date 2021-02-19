import { flowOf } from "./Flow";
import { Scope } from "./Scope";
import { awaitCancelation, suspend, wait } from "./Util";

describe(`Scope tests`, () => {
  it(`race cancels slower coroutine 1`, (done) => {
    new Scope({ errorCallback: (error) => { done(error); }})
      .launch(function* () {
        let finallyCalled = false

        const result = yield* suspend(this.race(
          this.callAsync(function* () {
            yield wait(0);
            return 0;
          }),
          this.callAsync(function* () {
            try {
              yield wait(5);
              done(`this should not run`);
              this.cancel();
              return 1;
            } finally {
              finallyCalled = true;
            }
          }),
        ));

        if (result === 0 && finallyCalled) {
          done();
        } else {
          done(`result: ${result} finallyCalled: ${finallyCalled}`);
        }

        this.cancel();
      });
  });

  it(`race cancels slower coroutine 2`, (done) => {
    new Scope({ errorCallback: (error) => { done(error); }})
      .launch(function* () {
        let finallyCalled = false

        const result = yield* suspend(this.race(
          this.callAsync(function* () {
            try {
              yield wait(5);
              done(`this should not run`);
              this.cancel();
              return 1;
            } finally {
              finallyCalled = true;
            }
          }),
          this.callAsync(function* () {
            yield wait(0);
            return 0;
          }),
        ));

        if (result === 0 && finallyCalled) {
          done();
        } else {
          done(`result: ${result} finallyCalled: ${finallyCalled}`);
        }

        this.cancel();
      });
  });

  it(`sibling coroutine is canceled when scope is canceled`, (done) => {
    const scope = new Scope();

    scope.launch(function* () {
      try {
        yield wait(5);
      } finally {
        done();
      }
    });

    scope.launch(function* () {
      throw new Error();
    });
  });

  it(`coroutine is canceled when scope is canceled`, (done) => {
    const scope = new Scope();

    scope.launch(function* () {
      try {
        yield awaitCancelation();
      } finally {
        done();
      }
    });

    scope.cancel();
  });

  it(`canceling a coroutine doesn't cancel it's scope`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    const cancelFunction = scope.launch(function* () {
      yield awaitCancelation();
    });

    cancelFunction();

    scope.launch(function* () {
      done();
    });
  });

  it(`throwing in non-canceling scope doesn't cancel it`, (done) => {
    const scope = new Scope({ isCancelable: false, errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      throw new Error();
    });

    if (!scope.isActive()) {
      done(`scope is no longer active after throw`);
    }

    scope.launch(function*() {
      done();
    });
  });

  it(`calling coroutine asynchronously`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      const asyncValue = this.callAsync(function* () {
        return 1;
      });

      const value = yield* suspend(asyncValue);

      if (value === 1) {
        done();
      } else {
        done(`unexpected result`);
      }
    });
  });

  it(`calling coroutine asynchronously in finally block`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    const cancel = scope.launch(function* () {
      try {
        yield awaitCancelation();
      } finally {
        const asyncValue = this.callAsync(function* () {
          return 1;
        });

        const value = yield* suspend(asyncValue);

        if (value === 1) {
          done();
        } else {
          done(`unexpected result`);
        }
      }
    });

    cancel();
  });

  it(`calling coroutine asynchronously in finally block on canceled scope`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      try {
        yield awaitCancelation();
      } finally {
        const asyncValue = this.callAsync(function* () {
          return 1;
        });

        const value = yield* suspend(asyncValue);

        if (value === 1) {
          done();
        } else {
          done(`unexpected result`);
        }
      }
    });

    scope.cancel();
  });

  it(`calling another coroutine`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      const value = yield* this.call(function* () {
        return 1;
      });

      if (value === 1) {
        done();
      } else {
        done(`unexpected result`);
      }
    });
  });

  it(`calling another coroutine in finally block`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    const cancel = scope.launch(function* () {
      try {
        yield awaitCancelation();
      } finally {
        yield wait(1);

        const value = yield* this.call(function* () {
          yield wait(1);
          return 1;
        });

        if (value === 1) {
          done();
        } else {
          done(`unexpected result`);
        }
      }
    });

    cancel();
  });

  it(`calling another coroutine in finally block on canceled scope`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      try {
        yield awaitCancelation();
      } finally {
        yield wait(1);

        const value = yield* this.call(function* () {
          yield wait(1);
          return 1;
        });

        if (value === 1) {
          done();
        } else {
          done(`unexpected result`);
        }
      }
    });

    scope.cancel();
  });

  it(`completed coroutines are not longer referenced by scope`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      yield wait(1);
    });

    setTimeout(() => {
      if (scope._cancelCallbacks.size === 0) {
        done();
      } else {
        done(`scope still has reference to coroutine`);
      }
    }, 5);
  });

  it(`completed flows are not longer referenced by scope`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    flowOf<number>((observer) => function*() {
      observer.emit(1);
      observer.emit(2);
      observer.emit(3);
    }).launchIn(scope);

    setTimeout(() => {
      if (scope._cancelCallbacks.size === 0) {
        done();
      } else {
        done(`scope still has reference to coroutine`);
      }
    }, 5);
  });
});
