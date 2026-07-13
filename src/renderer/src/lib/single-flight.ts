export class SingleFlight {
  private active?: Promise<void>

  run(operation: () => Promise<void>): Promise<void> {
    if (this.active) return this.active

    let operationResult: Promise<void>
    try {
      operationResult = operation()
    } catch (error) {
      operationResult = Promise.reject(error)
    }
    const active = operationResult.finally(() => {
      if (this.active === active) this.active = undefined
    })
    this.active = active
    return active
  }
}
