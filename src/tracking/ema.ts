export class EMA {
  private alpha: number
  private x: number | null = null
  private y: number | null = null

  constructor(alpha: number = 0.35) {
    this.alpha = alpha
  }
  update(nx: number, ny: number): [number, number] {
    if (this.x === null || this.y === null) {
      this.x = nx; this.y = ny
    } else {
      this.x = this.alpha * nx + (1 - this.alpha) * this.x
      this.y = this.alpha * ny + (1 - this.alpha) * this.y
    }
    return [this.x, this.y]
  }
  reset() { this.x = null; this.y = null }
}
