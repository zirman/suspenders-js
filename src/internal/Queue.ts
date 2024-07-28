type Link<T> = { left: LinkOrNull<T>, value: T, right: LinkOrNull<T> }
type LinkOrNull<T> = Link<T> | null

export class Queue<T> {
    #length: number = 0
    #tail: LinkOrNull<T> = null
    #head: LinkOrNull<T> = null

    enqueue(value: T) {
        const head = { left: this.#head, value: value, right: null }
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

    * [Symbol.iterator]() {
        let tail = this.#tail
        while (tail) {
            yield tail.value
            tail = tail.right
        }
    }
}
