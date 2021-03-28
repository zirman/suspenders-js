import { ResultCallback, Suspender } from "./Types";

/**
 * Channels are used to send and receive messages between coroutines. Channels can be buffered so
 * that senders do not suspend if there isn't a receiver waiting to receive the next message.
 * If there are multiple coroutines receiving on the same channel, they receive new values in first
 * come first served order.
 */
export class Channel<T> {
  private _receiverSuspenders: Array<ResultCallback<T>> = []
  private _buffer: Array<[T, ResultCallback<void> | void]> = []
  private readonly _bufferSize: number

  constructor(options?: { bufferSize?: number }) {
    this._bufferSize = options?.bufferSize ?? 0;
  }

  /**
   * Receives a message on this channel. A buffered message is received or if there is none, this
   * suspends the receiver until one is available. Multiple suspended receivers are resumed in first
   * come first served order.
   * @param resultCallback
   */
  receive: Suspender<T> = (resultCallback) => {
    const valueCallback = this._buffer.shift();

    // check for a queued value
    if (valueCallback !== undefined) {
      const senderSuccessCallback = valueCallback[1];
      // resume sender first to get round robin order

      // resume sender if suspended
      if (senderSuccessCallback !== undefined) {
        senderSuccessCallback({ value: undefined });
      }

      // resume receiver
      resultCallback({ value: valueCallback[0] });

      // count how many suspended senders can be resumed to fill buffer to max
      let resumeCount = 0;

      for (let index = 0; index < this._buffer.length; index++) {
        if (resumeCount >= this._bufferSize) {
          break;
        }

        const pair = this._buffer[index]!
        const senderSuccessCallback = pair[1];

        // resumes sender by buffering it's value
        if (senderSuccessCallback !== undefined) {
          senderSuccessCallback({ value: undefined });
          pair[1] = undefined;
        }

        resumeCount++;
      }

      return;
    } else {
      this._receiverSuspenders.push(resultCallback);

      return () => {
        const index = this._receiverSuspenders.findIndex((x)=> x === resultCallback);

        if (index !== -1) {
          this._receiverSuspenders.splice(index, 1);
        }
      };
    }
  }

  /**
   * Sends a message on this channel. If there is a queued receiver coroutine, it is resumed
   * immediately to process the message. If there are no queued receivers and buffer is full, the
   * sending coroutine is suspended until next message is received on this channel. Multiple
   * suspended senders are resumed in order they were suspended.
   * @param value
   */
  send(value: T): Suspender<void> {
    return (resultCallback) => {
      const receiver = this._receiverSuspenders.shift();

      if (receiver !== undefined) {
        // receiver was waiting for value
        receiver({ value });
        resultCallback({ value: undefined });
        return;
      } else if (this._buffer.length < this._bufferSize) {
        // buffer value but don't block sender
        const valueCallback: [T, void] = [value, undefined];
        this._buffer.push(valueCallback);
        resultCallback({ value: undefined });
        return;
      } else {
        // block sender until receiver gets value
        const valueCallback: [T, ResultCallback<void>] = [value, resultCallback];
        this._buffer.push(valueCallback);

        return () => {
          const index = this._buffer.findIndex((x) => x === valueCallback);

          if (index !== -1) {
            this._buffer.splice(index, 1);
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
    const receiver = this._receiverSuspenders.shift();

    if (receiver !== undefined) {
      // receiver was waiting for value
      receiver({ value });
      return true;
    } else if (this._buffer.length < this._bufferSize) {
      // buffer value
      const valueCallback: [T, void] = [value, undefined];
      this._buffer.push(valueCallback);
      return true;
    } else {
      return false;
    }
  }
}
