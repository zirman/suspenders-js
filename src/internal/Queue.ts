class Link<T> {
    constructor(public left: MaybeLink<T>, public value: T, public right: MaybeLink<T>) {
    }
}

export class Queue<T> {
    #length: number = 0
    #tail: MaybeLink<T> = null
    #head: MaybeLink<T> = null

    enqueue(value: T) {
        const head = new Link(this.#head, value, null)
        if (this.#head !== null) {
            this.#head.right = head
        } else {
            this.#tail = head
        }
        this.#head = head
        this.#length++
    }

    dequeue(): T | null {
        if (this.#tail === null) return null
        const value = this.#tail.value
        this.#tail = this.#tail.right
        if (this.#tail === null) {
            this.#head = null
        }
        this.#length--
        return value
    }

    length(): number {
        return this.#length
    }

    *[Symbol.iterator]() {
        let tail = this.#tail
        while (tail) {
            yield tail.value
            tail = tail.right
        }
    }
}

type MaybeLink<T> = Link<T> | null
