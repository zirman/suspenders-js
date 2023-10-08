export interface Job {
    isActive(): boolean

    cancel(): boolean
}
