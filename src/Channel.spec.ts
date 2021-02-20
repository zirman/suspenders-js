import { Channel } from "./Channel";
import { Scope } from "./Scope";

describe(`channel tests`, () => {
  it(`channel send/receive messages`, (done) => {
    const channel = new Channel<number>();
    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      try {
        if ((yield* this.suspend(channel.receive)) !== 0) {
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

  it(`channel multiple receiver round robin order`, (done) => {
    const channel = new Channel<number>();

    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      if ((yield* this.suspend(channel.receive)) !== 0) {
        done(`received out of order 0`);
        this.cancel();
        return;
      }

      if ((yield* this.suspend(channel.receive)) !== 3) {
        done(`received out of order 3`);
        this.cancel();
        return;
      }
    });

    scope.launch(function* () {
      try {
        if ((yield* this.suspend(channel.receive)) !== 1) {
          done(`received out of order 1`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 4) {
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
        if ((yield* this.suspend(channel.receive)) !== 2) {
          done(`received out of order 2`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 5) {
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

  it(`channel multiple sender round robin order`, (done) => {
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
        if ((yield* this.suspend(channel.receive)) !== 0) {
          done(`received out of order 0`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 1) {
          done(`received out of order 1`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 2) {
          done(`received out of order 2`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 3) {
          done(`received out of order 3`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 4) {
          done(`received out of order 4`);
          return;
        }

        if ((yield* this.suspend(channel.receive)) !== 5) {
          done(`received out of order 5`);
          return;
        }

        done();
      } finally {
        this.cancel();
      }
    });
  });

  it(`channel buffer single message`, (done) => {
    const channel = new Channel<number>({ bufferSize: 1 });

    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      yield channel.send(0);
      done();
      this.cancel();
      yield channel.send(1);
    });
  });

  it(`channel receiving buffered message resumes suspended sender`, (done) => {
    const channel = new Channel<number>({ bufferSize: 1 });

    const scope = new Scope({ errorCallback: (error) => { done(error); }});

    scope.launch(function* () {
      yield channel.send(0);
      yield channel.send(1);
      done();
      this.cancel();
    });

    scope.launch(function* () {
      yield channel.receive;
    });
  });
});
