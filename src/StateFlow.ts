import { Flow } from "./Flow.js"

export interface StateFlow<T> extends Flow<T> {
    get(): T
}
