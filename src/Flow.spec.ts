import { flowOf, flowOfValues } from "./Flow";
import { Scope } from "./Scope";

describe(`Flow tests`, () => {
  it(`throwing error in flowOfValues().map() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOfValues().filter() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .filter(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOfValues().flatMap() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .mergeMap(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOfValues().onEach() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .onEach(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOfValues().collect() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function*() {
      yield flowOfValues(1, 2, 3)
        .collect(() => { throw new Error(); });
    });
  });

  it(`throwing error in flowOfValues().collectLatest() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function*() {
      yield flowOfValues(1, 2, 3)
        .collectLatest(() => function*() { throw new Error(); });
    });
  });

  it(`throwing error in flowOfValues().transform() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .transform<null>(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOfValues().transformLatest() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOfValues(1, 2, 3)
      .transformLatest<null>(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it(`parent scope error callback is called when child scope errors`, (done) => {
    const parent = new Scope({ errorCallback: () => { done(); }});
    const scope = new Scope({ parent });

    flowOfValues(1, 2, 3)
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf().map() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((collector) => function*() { collector.emit(null) })
      .map(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf().filter() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((collector) => function*() { collector.emit(null) })
      .filter(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf().flatMap() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((collector) => function*() { collector.emit(null) })
      .mergeMap(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf().onEach() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((collector) => function*() { collector.emit(null) })
      .onEach(() => { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf().collect() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function* () {
      yield flowOf<null>((collector) => function*() { collector.emit(null) })
        .collect(() => { throw new Error(); });
    });
  });

  it(`throwing error in flowOf().collectLatest() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    scope.launch(function* () {
      yield flowOf<null>((collector) => function*() { collector.emit(null) })
        .collectLatest(() => function*() { throw new Error(); });
    });
  });

  it(`throwing error in flowOf().transform() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((collector) => function*() { collector.emit(null) })
      .transform(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it(`throwing error in flowOf().transformLatest() calls scope error callback`, (done) => {
    const scope = new Scope({ errorCallback: () => { done(); }});

    flowOf<null>((collector) => function*() { collector.emit(null) })
      .transformLatest(() => function*() { throw new Error(); })
      .launchIn(scope);
  });

  it(`catching a flow resumes in catch coroutine`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    flowOf<number>((collector) => function*() {
      collector.emit(0);
      throw new Error();
    })
      .catch((_, collector) => function*() {
        collector.emit(1);
      })
      .onEach((i) => {
        if (scope.isActive() && i === 1) {
          done();
          scope.cancel();
        }
      })
      .launchIn(scope);
  });

  it(`collect resumes coroutine when flow completes`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function*() {
      yield flowOf<null>((collector) => function*() { collector.emit(null) })
        .collect(() => {});

      done();
    })
  });

  it(`collectLatest resumes coroutine when flow completes`, (done) => {
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function*() {
      yield flowOf<null>((collector) => function*() { collector.emit(null); })
        .collectLatest(() => function*() {});

      done();
    })
  });
});
