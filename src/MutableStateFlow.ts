import { StateFlow } from "./StateFlow.js"

export interface MutableStateFlow<T> extends StateFlow<T> {
    set(value: T): void
}
