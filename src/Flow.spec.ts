import { Channel } from "./Channel";
import { flowOf, flowOfValues } from "./Flow";
import { Scope } from "./Scope";
import { suspend, wait } from "./Util";

describe("scope error callback is called when an error occurs in a flow", () => {
  it("throwing error in flowOfValues().map() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOfValues().filter() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .filter(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOfValues().flatMap() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .flatMap(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOfValues().onEach() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .onEach(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOfValues().collect() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function*() {
      yield flowOfValues(1, 2, 3)
        .collect(this, () => { throw new Error(); });
    });
  });

  it("throwing error in flowOfValues().collectLatest() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function*() {
      yield flowOfValues(1, 2, 3)
        .collectLatest(this, () => function*() { throw new Error(); });
    });
  });

  it("throwing error in flowOfValues().transform() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .transform<null>(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOfValues().transformLatest() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .transformLatest<null>(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it("parent scope error callback is called when child scope errors", (done) => {
    const parent = new Scope({ errorCallback: () => { done(); }});
    const scope = new Scope({ parent });

    flowOfValues(1, 2, 3)
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf().map() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((observer) => function*() { observer.emit(null) })
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf().filter() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((observer) => function*() { observer.emit(null) })
      .filter(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf().flatMap() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((observer) => function*() { observer.emit(null) })
      .flatMap(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf().onEach() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((observer) => function*() { observer.emit(null) })
      .onEach(() => { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf().collect() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function* () {
      yield flowOf<null>((observer) => function*() { observer.emit(null) })
        .collect(this, () => { throw new Error(); });
    });
  });

  it("throwing error in flowOf().collectLatest() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function* () {
      yield flowOf<null>((observer) => function*() { observer.emit(null) })
        .collectLatest(this, () => function*() { throw new Error(); });
    });
  });

  it("throwing error in flowOf().transform() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((observer) => function*() { observer.emit(null) })
      .transform(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it("throwing error in flowOf().transformLatest() calls scope error callback", (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((observer) => function*() { observer.emit(null) })
      .transformLatest(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it("race cancels slower coroutine 1", (done) => {
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

  it("race cancels slower coroutine 2", (done) => {
    new Scope({ errorCallback: (error) => { done(error); }})
      .launch(function* () {
        let finallyCalled = false

        const result = yield* suspend(this.race(
          this.callAsync(function* () {
            try {
              yield wait(5);
              done(`this should not run`);
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

  it("channel send/receive messages", (done) => {
    const channel = new Channel<number>();
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      try {
        if ((yield* suspend(channel.receive)) !== 0) {
          done(`didn't receive expected message`);
          return;
        }

        done();
      } finally {
        this.cancel();
      }
    });

    scope.launch(function* () {
      yield channel.send(0);
    });
  });

  it("channel multiple receiver round robin order", (done) => {
    const channel = new Channel<number>();

    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      if ((yield* suspend(channel.receive)) !== 0) {
        done(`received out of order 0`);
        this.cancel();
        return;
      }

      if ((yield* suspend(channel.receive)) !== 3) {
        done(`received out of order 3`);
        this.cancel();
        return;
      }
    });

    scope.launch(function* () {
      try {
        if ((yield* suspend(channel.receive)) !== 1) {
          done(`received out of order 1`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 4) {
          done(`received out of order 4`);
          return;
        }

        done();
      } finally {
        this.cancel();
      }
    });

    scope.launch(function* () {
      try {
        if ((yield* suspend(channel.receive)) !== 2) {
          done(`received out of order 2`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 5) {
          done(`received out of order 5`);
          return;
        }

        done();
      } finally {
        this.cancel();
      }
    });

    scope.launch(function* () {
      yield channel.send(0);
      yield channel.send(1);
      yield channel.send(2);
      yield channel.send(3);
      yield channel.send(4);
      yield channel.send(5);
    });
  });

  it("channel multiple sender round robin order", (done) => {
    const channel = new Channel<number>();

    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      yield channel.send(0);
      yield channel.send(3);
    });

    scope.launch(function* () {
      yield channel.send(1);
      yield channel.send(4);
    });

    scope.launch(function* () {
      yield channel.send(2);
      yield channel.send(5);
    });

    scope.launch(function* () {
      try {
        if ((yield* suspend(channel.receive)) !== 0) {
          done(`received out of order 0`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 1) {
          done(`received out of order 1`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 2) {
          done(`received out of order 2`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 3) {
          done(`received out of order 3`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 4) {
          done(`received out of order 4`);
          return;
        }

        if ((yield* suspend(channel.receive)) !== 5) {
          done(`received out of order 5`);
          return;
        }

        done();
      } finally {
        this.cancel();
      }
    });
  });
});
