/**
 * A Job is a node in a hierarch of running processes with parent child relationships. A running
 * job is active. Canceling a job will complete the job and any child jobs.
 */
export interface Job {
    isActive(): boolean

    cancel(): boolean
}
