import { Observer, ResultCallback, Suspender } from "./Types.js";

/**
 * Channels are used to send and receive messages between coroutines. Channels can be buffered so
 * that senders do not suspend if there isn't a receiver waiting to receive the next message.
 * If there are multiple coroutines receiving on the same channel, they receive new values in first
 * come first served order.
 */
export class Channel<T> {
  private receiverSuspenders: Array<ResultCallback<T>> = []
  private buffer: Array<[T, ResultCallback<void> | void]> = []
  private bufferSize: number

  constructor(args?: { bufferSize?: number }) {
    this.bufferSize = args?.bufferSize ?? 0;
  }

  /**
   * Receives a message on this channel. A buffered message is received or if there is none, this
   * suspends the receiver until one is available. Multiple suspended receivers are resumed in first
   * come first served order.
   * @param resultCallback
   */
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

  /**
   * Sends a message on this channel. If there is a queued receiver coroutine, it is resumed
   * immediately to process the message. If there are no queued receivers and buffer is full, the
   * sending coroutine is suspened until next message is received on this channel. Multiple
   * suspended senders are resumed in order they were suspended.
   * @param value
   */
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

  /**
   * Tries to send a message on the channel. Returns true if successful, or false if buffer is full.
   * @param value
   */
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
