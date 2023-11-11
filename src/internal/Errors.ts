export class NoSuchElementException extends Error {
    constructor() {
        super("No such element")
    }
}

class ChannelClosedImpl implements Error {
    static instance = new ChannelClosedImpl()

    name = "ChannelClosed"
    message = "Channel closed"

    private constructor() { }
}

export const ChannelClosed = ChannelClosedImpl.instance

export class ConcurrentWrite extends Error {
    constructor() {
        super("Concurrent Write")
    }
}

class ClosedSendChannelExceptionImpl implements Error {
    static instance = new ClosedSendChannelExceptionImpl()

    name = "ClosedSendChannelException"
    message = "ClosedSendChannelException"

    private constructor() { }
}

export const ClosedSendChannelException = ClosedSendChannelExceptionImpl.instance
